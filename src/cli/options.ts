import { Array, Match, pipe } from 'effect';
import { HELP_TEXT } from '../constants/messages.js';
import type { CliOptions } from '../domain/types.js';

type ParseStep = {
  readonly options: CliOptions;
  readonly skipCount: number;
  readonly warnings: ReadonlyArray<string>;
};

const step = (options: CliOptions): ParseStep => ({ options, skipCount: 0, warnings: [] });

const splitList = (value: string): ReadonlyArray<string> =>
  pipe(
    value.split(','),
    Array.map((item) => item.trim()),
    Array.filter((item) => item.length > 0),
  );

const requireValue = (
  flag: string,
  nextArg: string | undefined,
  options: CliOptions,
  apply: (value: string) => CliOptions,
): ParseStep =>
  nextArg === undefined || nextArg.startsWith('-')
    ? {
        options,
        skipCount: 0,
        warnings: [`${flag} requires a value but none was provided; flag ignored.`],
      }
    : { options: apply(nextArg), skipCount: 1, warnings: [] };

const parseArgument = (arg: string, nextArg: string | undefined, options: CliOptions): ParseStep =>
  Match.value(arg).pipe(
    Match.when(Match.is('-t', '--text'), () => step({ ...options, format: 'text' })),
    Match.when(Match.is('-j', '--json'), () => step({ ...options, format: 'json' })),
    Match.when(Match.is('-a', '--all'), () => step({ ...options, checkAll: true })),
    Match.when(Match.is('-p', '--check-peer'), () => step({ ...options, checkPeer: true })),
    Match.when(Match.is('-h', '--help'), () => step({ ...options, showHelp: true })),
    Match.when(Match.is('-i', '--ignore'), () =>
      requireValue('--ignore', nextArg, options, (value) => ({
        ...options,
        ignoredPackages: [...options.ignoredPackages, ...splitList(value)],
      })),
    ),
    Match.when(Match.is('-e', '--exclude'), () =>
      requireValue('--exclude', nextArg, options, (value) => ({
        ...options,
        excludePatterns: [...options.excludePatterns, ...splitList(value)],
      })),
    ),
    Match.when('--no-auto-detect', () => step({ ...options, noAutoDetect: true })),
    Match.when(
      (flag) => flag.startsWith('-'),
      (flag) => ({
        options,
        skipCount: 0,
        warnings: [`Unknown option ${flag} ignored. Run with --help to see supported flags.`],
      }),
    ),
    Match.orElse(() => step(options)),
  );

const DEFAULT_OPTIONS: CliOptions = {
  format: 'text',
  checkAll: false,
  checkPeer: false,
  ignoredPackages: [],
  excludePatterns: [],
  noAutoDetect: false,
  showHelp: false,
  rootDir: '.',
  packageJsonPath: './package.json',
  warnings: [],
};

export const parseCliOptions = (args: ReadonlyArray<string>): CliOptions => {
  const parsed = Array.reduce(
    args,
    { options: DEFAULT_OPTIONS, skippedUntil: -1, warnings: [] as ReadonlyArray<string> },
    (acc, arg, index) =>
      index <= acc.skippedUntil
        ? acc
        : pipe(parseArgument(arg, args[index + 1], acc.options), (result) => ({
            options: result.options,
            skippedUntil: index + result.skipCount,
            warnings: [...acc.warnings, ...result.warnings],
          })),
  );

  return { ...parsed.options, warnings: parsed.warnings };
};

export const printHelp = (): void => {
  console.log(HELP_TEXT);
};
