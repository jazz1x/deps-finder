import { join } from 'node:path';
import { Array, Console, Effect, Option, Record, String, pipe } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';
import { analyzeDependencies, unusedCandidates } from '../analyzers/dependency-analyzer.js';
import { binaryUses, peerUses } from '../analyzers/implied-usage.js';
import { CLI_TEXT, MESSAGES } from '../constants/messages.js';
import {
  type FileError,
  InstallRequired,
  IssuesFound,
  PlugAndPlayUnread,
  type RunFailure,
  type RunOutcome,
} from '../domain/errors.js';
import {
  type CliOptions,
  DEPENDENCY_TYPES,
  type DependencyType,
  type ImportDetails,
  Installation,
  type PackageJson,
  type PackageName,
  type ScriptCommand,
} from '../domain/types.js';
import { readToolConfigs } from '../parsers/config-references.js';
import { elideTypeOnlyImports } from '../parsers/elision.js';
import { findFiles, parseHoistedImports, parseMultipleFiles } from '../parsers/import-parser.js';
import { readInstallation } from '../parsers/installed-packages.js';
import { type LayoutManifest, readPackageJson } from '../parsers/package-parser.js';
import { readHookCommands } from '../parsers/script-parser.js';
import { tsconfigImports } from '../parsers/tsconfig-parser.js';
import { ansi, hasIssues, plain, report } from '../reporters/console-reporter.js';
import { formatSkippedInput, formatSkippedSource } from '../reporters/error-reporter.js';
import { stdoutColours } from './terminal.js';

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
    ['optionalDependencies', () => true],
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

const paintForStdout = Effect.sync(() => (stdoutColours() ? ansi : plain));

const scriptCommands = (manifest: LayoutManifest): ReadonlyArray<ScriptCommand> =>
  Array.map(Record.values(manifest.scripts), (script) => ({
    file: manifest.path,
    script,
    scripts: Record.keys(manifest.scripts),
  }));

const declaredPackages = (packageJson: PackageJson): ReadonlyArray<PackageName> =>
  Array.dedupe(Array.flatMap(DEPENDENCY_TYPES, (section) => packageJson[section]));

const unreadable = (installation: Installation, root: string): Option.Option<RunFailure> =>
  Installation.$match(installation, {
    Installed: () => Option.none(),
    NotInstalled: () => Option.some(InstallRequired({ root })),
    PlugAndPlay: () => Option.some(PlugAndPlayUnread({ root })),
  });

// Without an install, peers and binaries are unknown, so nothing can be called unused.
const requireInstallation = (
  options: CliOptions,
  packageJson: PackageJson,
  installation: Installation,
): Effect.Effect<void, RunFailure> =>
  pipe(
    unusedCandidates(packageJson, options),
    ({ unused, unusedPeer }) => [...unused, ...unusedPeer],
    Array.match({
      onEmpty: () => Effect.void,
      onNonEmpty: () =>
        Option.match(unreadable(installation, options.rootDir), {
          onNone: () => Effect.void,
          onSome: Effect.fail,
        }),
    }),
  );

// Scripts, git hooks, tool configs and peers use packages that no source file imports.
const usesWithoutImport = (
  rootDir: string,
  packageJson: PackageJson,
  { installation, skipped }: ReturnType<typeof readInstallation>,
  files: ReturnType<typeof findFiles>,
  imports: ReadonlyArray<ImportDetails>,
) => {
  const declared = declaredPackages(packageJson);
  const configs = readToolConfigs(files.layoutRoots, files.manifests);
  const hooks = readHookCommands(
    rootDir,
    pipe(
      Array.findFirst(
        files.manifests,
        (manifest) => manifest.path === join(rootDir, 'package.json'),
      ),
      Option.match({ onNone: () => [], onSome: (root) => Record.keys(root.scripts) }),
    ),
  );
  const commands = [
    ...Array.flatMap(files.manifests, scriptCommands),
    ...hooks.found,
    ...configs.commands,
  ];
  const seeds = [
    ...imports,
    ...configs.references,
    ...binaryUses(commands, installation, declared),
  ];
  return {
    imports: [...seeds, ...peerUses(installation, declared, seeds)],
    skipped: [...skipped, ...configs.skipped, ...hooks.skipped],
  };
};

const analyzeProject = (
  options: CliOptions,
): Effect.Effect<void, FileError | RunOutcome | RunFailure> =>
  pipe(
    Effect.fromResult(readPackageJson(join(options.rootDir, 'package.json'))),
    Effect.map((packageJson) => ({
      packageJson,
      installed: readInstallation(options.rootDir, declaredPackages(packageJson)),
    })),
    Effect.tap(({ packageJson, installed }) =>
      requireInstallation(options, packageJson, installed.installation),
    ),
    Effect.map(({ packageJson, installed }) => ({
      packageJson,
      installed,
      files: findFiles(options.rootDir, {
        excludePatterns: options.excludePatterns,
        noAutoDetect: options.noAutoDetect,
      }),
    })),
    Effect.map(({ packageJson, installed, files }) => ({
      packageJson,
      installed,
      files,
      own: parseMultipleFiles(files.found),
      hoisted: parseHoistedImports(files.packages),
    })),
    Effect.map(({ packageJson, installed, files, own, hoisted }) => ({
      packageJson,
      installed,
      files,
      own,
      hoisted,
      emitted: elideTypeOnlyImports(
        packageJson,
        [...own.imports, ...hoisted.imports, ...tsconfigImports(files.tsconfigs)],
        files.found,
      ),
    })),
    Effect.map(({ packageJson, installed, files, own, hoisted, emitted }) => ({
      packageJson,
      files,
      own,
      hoisted,
      emitted,
      unimported: usesWithoutImport(
        options.rootDir,
        packageJson,
        installed,
        files,
        emitted.imports,
      ),
    })),
    Effect.map(({ packageJson, files, own, hoisted, emitted, unimported }) => ({
      packageJson,
      // The walk, the hoisting credit and the elision re-read can each read the same file.
      skippedInputs: Array.dedupe([
        ...files.skipped,
        ...hoisted.skipped,
        ...emitted.skipped,
        ...unimported.skipped,
      ]),
      packagesLeftOut: Array.map(files.packages, (leftOut) => leftOut.dir),
      sources: {
        imports: unimported.imports,
        unreadable: [...files.unreadable, ...own.unreadable, ...hoisted.unreadable],
        partlyParsed: [...own.partlyParsed, ...hoisted.partlyParsed],
      },
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
    Effect.tap(({ sources }) =>
      Effect.forEach(sources.partlyParsed, ({ path, reason }) =>
        Console.error(MESSAGES.SOURCE_PARSE_STOPPED(path, reason)),
      ),
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
