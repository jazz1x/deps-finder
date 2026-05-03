import { A, pipe, S } from '@mobily/ts-belt';
import { match } from 'ts-pattern';
import { HELP_TEXT } from '../constants/messages.js';
import type { CliOptions } from '../domain/types.js';
import { isString } from '../utils/type-guards.js';

const isOption = (arg: string | undefined): boolean => isString(arg) && S.startsWith(arg, '-');

type ParseStep = {
  readonly options: CliOptions;
  readonly skipCount: number;
  readonly warnings: ReadonlyArray<string>;
};

const requireValue = (
  flag: string,
  nextArg: string | undefined,
  options: CliOptions,
  apply: (value: string) => CliOptions,
): ParseStep => {
  if (!isString(nextArg) || isOption(nextArg)) {
    return {
      options,
      skipCount: 0,
      warnings: [`${flag} requires a value but none was provided; flag ignored.`],
    };
  }
  return { options: apply(nextArg), skipCount: 1, warnings: [] };
};

const parseArgument = (
  allArgs: ReadonlyArray<string>,
  index: number,
  options: CliOptions,
): ParseStep => {
  const arg = allArgs[index];
  const nextArg = allArgs[index + 1];

  return match(arg)
    .with('-t', '--text', () => ({
      options: { ...options, format: 'text' as const },
      skipCount: 0,
      warnings: [],
    }))
    .with('-j', '--json', () => ({
      options: { ...options, format: 'json' as const },
      skipCount: 0,
      warnings: [],
    }))
    .with('-a', '--all', () => ({
      options: { ...options, checkAll: true },
      skipCount: 0,
      warnings: [],
    }))
    .with('-p', '--check-peer', () => ({
      options: { ...options, checkPeer: true },
      skipCount: 0,
      warnings: [],
    }))
    .with('-h', '--help', () => ({
      options: { ...options, showHelp: true },
      skipCount: 0,
      warnings: [],
    }))
    .with('-i', '--ignore', () =>
      requireValue('--ignore', nextArg, options, (value) => ({
        ...options,
        ignoredPackages: [
          ...options.ignoredPackages,
          ...pipe(value, S.split(','), A.map(S.trim), A.filter(S.isNotEmpty)),
        ],
      })),
    )
    .with('-e', '--exclude', () =>
      requireValue('--exclude', nextArg, options, (value) => ({
        ...options,
        excludePatterns: [
          ...options.excludePatterns,
          ...pipe(value, S.split(','), A.map(S.trim), A.filter(S.isNotEmpty)),
        ],
      })),
    )
    .with('--no-auto-detect', () => ({
      options: { ...options, noAutoDetect: true },
      skipCount: 0,
      warnings: [],
    }))
    .otherwise(() => {
      if (isString(arg) && S.startsWith(arg, '-')) {
        return {
          options,
          skipCount: 0,
          warnings: [`Unknown option ${arg} ignored. Run with --help to see supported flags.`],
        };
      }
      return { options, skipCount: 0, warnings: [] };
    });
};

export const parseCliOptions = (args: ReadonlyArray<string>): CliOptions => {
  const defaultOptions: CliOptions = {
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

  const finalAcc = pipe(
    args,
    A.reduceWithIndex(
      { options: defaultOptions, skippedUntil: -1, warnings: [] as ReadonlyArray<string> },
      (acc, _arg, index) => {
        if (index <= acc.skippedUntil) {
          return acc;
        }

        const result = parseArgument(args, index, acc.options);
        return {
          options: result.options,
          skippedUntil: index + result.skipCount,
          warnings: [...acc.warnings, ...result.warnings],
        };
      },
    ),
  );

  return { ...finalAcc.options, warnings: finalAcc.warnings };
};

export const printHelp = (): void => {
  console.log(HELP_TEXT);
};
