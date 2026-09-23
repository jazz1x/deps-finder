import { Array, Result, pipe } from 'effect';
import { analyzeDependencies } from './analyzers/dependency-analyzer.js';
import { parseCliOptions, printHelp } from './cli/options.js';
import { MESSAGES } from './constants/messages.js';
import type { CliOptions } from './domain/types.js';
import { findFiles, parseMultipleFiles } from './parsers/import-parser.js';
import { readPackageJson } from './parsers/package-parser.js';
import { hasIssues, report } from './reporters/console-reporter.js';
import { formatFileError } from './reporters/error-reporter.js';

const showHelp = (): number => {
  printHelp();
  return 0;
};

const analyze = (options: CliOptions): number => {
  Array.forEach(options.warnings, (w) => console.error(`${MESSAGES.WARNING_PREFIX} ${w}`));

  return pipe(
    readPackageJson(options.packageJsonPath),
    Result.map((packageJson) =>
      analyzeDependencies(
        packageJson,
        parseMultipleFiles(
          findFiles(options.rootDir, {
            excludePatterns: options.excludePatterns,
            noAutoDetect: options.noAutoDetect,
          }),
        ),
        {
          checkAll: options.checkAll,
          checkPeer: options.checkPeer,
          ignoredPackages: options.ignoredPackages,
        },
      ),
    ),
    Result.match({
      onSuccess: (result) => {
        console.log(report(result, options.format, options.ignoredPackages));
        return hasIssues(result) ? 1 : 0;
      },
      onFailure: (error) => {
        console.error(formatFileError(error));
        return 1;
      },
    }),
  );
};

const main = (args: ReadonlyArray<string>): number => {
  const options = parseCliOptions(args);
  return options.showHelp ? showHelp() : analyze(options);
};

process.exitCode = main(process.argv.slice(2));
