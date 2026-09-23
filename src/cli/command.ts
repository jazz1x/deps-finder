import { join } from 'node:path';
import { Array, Console, Effect, String, pipe } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';
import { analyzeDependencies } from '../analyzers/dependency-analyzer.js';
import { CLI_TEXT, MESSAGES } from '../constants/messages.js';
import { type FileError, IssuesFound, type RunOutcome } from '../domain/errors.js';
import type { CliOptions, DependencyType } from '../domain/types.js';
import { findFiles, parseMultipleFiles } from '../parsers/import-parser.js';
import { readPackageJson } from '../parsers/package-parser.js';
import { hasIssues, paintFor, report } from '../reporters/console-reporter.js';
import { formatSkippedInput, formatSkippedSource } from '../reporters/error-reporter.js';

const toggle = (name: string, alias: string, description: string) =>
  Flag.Boolean(name).pipe(
    Flag.withAlias(alias),
    Flag.withDescription(description),
    Flag.withDefault(false),
  );

const list = (name: string, alias: string, description: string) =>
  Flag.String(name).pipe(
    Flag.withAlias(alias),
    Flag.withDescription(description),
    Flag.atLeast(0),
    Flag.map((values) =>
      pipe(
        values,
        Array.flatMap(String.split(',')),
        Array.map(String.trim),
        Array.filter(String.isNonEmpty),
      ),
    ),
  );

const config = {
  root: Argument.String('root').pipe(
    Argument.withDescription(CLI_TEXT.ROOT),
    Argument.withDefault('.'),
  ),
  text: toggle('text', 't', CLI_TEXT.TEXT),
  json: toggle('json', 'j', CLI_TEXT.JSON),
  all: toggle('all', 'a', CLI_TEXT.ALL),
  checkPeer: toggle('check-peer', 'p', CLI_TEXT.CHECK_PEER),
  ignore: list('ignore', 'i', CLI_TEXT.IGNORE),
  exclude: list('exclude', 'e', CLI_TEXT.EXCLUDE),
  noAutoDetect: Flag.Boolean('no-auto-detect').pipe(
    Flag.withDescription(CLI_TEXT.NO_AUTO_DETECT),
    Flag.withDefault(false),
  ),
};

type ParsedFlags = Command.Command.Config.Infer<typeof config>;

const SECTION_SWITCHES: ReadonlyArray<readonly [DependencyType, (flags: ParsedFlags) => boolean]> =
  [
    ['dependencies', () => true],
    ['devDependencies', (flags) => flags.all],
    ['peerDependencies', (flags) => flags.all || flags.checkPeer],
  ];

const toCliOptions = (flags: ParsedFlags): CliOptions => ({
  format: flags.json ? 'json' : 'text',
  sections: pipe(
    SECTION_SWITCHES,
    Array.filter(([, isOn]) => isOn(flags)),
    Array.map(([section]) => section),
  ),
  ignoredPackages: flags.ignore,
  excludePatterns: flags.exclude,
  noAutoDetect: flags.noAutoDetect,
  rootDir: flags.root,
});

const paintForStdout = Effect.sync(() =>
  paintFor(process.stdout.isTTY === true, process.env['NO_COLOR']),
);

const analyzeProject = (options: CliOptions): Effect.Effect<void, FileError | RunOutcome> =>
  pipe(
    Effect.fromResult(readPackageJson(join(options.rootDir, 'package.json'))),
    Effect.map((packageJson) => ({
      packageJson,
      files: findFiles(options.rootDir, {
        excludePatterns: options.excludePatterns,
        noAutoDetect: options.noAutoDetect,
      }),
    })),
    Effect.map(({ packageJson, files }) => ({
      packageJson,
      skippedInputs: files.skipped,
      packagesLeftOut: files.packages,
      sources: parseMultipleFiles(files.found),
    })),
    Effect.tap(({ skippedInputs }) =>
      Effect.forEach(skippedInputs, (error) => Console.error(formatSkippedInput(error))),
    ),
    Effect.tap(({ packagesLeftOut }) =>
      Effect.forEach(packagesLeftOut, (dir) => Console.error(MESSAGES.PACKAGE_LEFT_OUT(dir))),
    ),
    Effect.tap(({ sources }) =>
      Effect.forEach(sources.unreadable, (error) => Console.error(formatSkippedSource(error))),
    ),
    Effect.map(({ packageJson, sources }) =>
      analyzeDependencies(packageJson, sources.imports, {
        sections: options.sections,
        ignoredPackages: options.ignoredPackages,
      }),
    ),
    Effect.tap((result) =>
      Effect.flatMap(paintForStdout, (paint) =>
        Console.log(report(result, options.format, options.ignoredPackages, paint)),
      ),
    ),
    Effect.flatMap((result) =>
      hasIssues(result) ? Effect.fail(IssuesFound({ total: result.totalIssues })) : Effect.void,
    ),
  );

export const depsFinder = Command.make('deps-finder', config, (flags) =>
  analyzeProject(toCliOptions(flags)),
).pipe(Command.withDescription(CLI_TEXT.COMMAND));
