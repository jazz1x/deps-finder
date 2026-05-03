import { A, R } from '@mobily/ts-belt';
import { analyzeDependencies } from './analyzers/dependency-analyzer.js';
import { parseCliOptions, printHelp } from './cli/options.js';
import { MESSAGES } from './constants/messages.js';
import { findFiles, parseMultipleFiles } from './parsers/import-parser.js';
import { readPackageJson } from './parsers/package-parser.js';
import { hasIssues, report } from './reporters/console-reporter.js';
import { formatFileError } from './reporters/error-reporter.js';

const main = (): void => {
  const args = process.argv.slice(2);
  const options = parseCliOptions(args);

  if (options.showHelp) {
    printHelp();
    process.exit(0);
  }

  A.forEach(options.warnings, (w) => console.error(`${MESSAGES.WARNING_PREFIX} ${w}`));

  const packageJson = R.match(
    readPackageJson(options.packageJsonPath),
    (data) => data,
    (error) => {
      console.error(formatFileError(error));
      process.exit(1);
    },
  );

  const files = findFiles(options.rootDir, {
    excludePatterns: options.excludePatterns,
    noAutoDetect: options.noAutoDetect,
  });

  const allImports = parseMultipleFiles(files);

  const analysisResult = analyzeDependencies(packageJson, allImports, {
    checkAll: options.checkAll,
    checkPeer: options.checkPeer,
    ignoredPackages: options.ignoredPackages,
  });

  const output = report(analysisResult, options.format, options.ignoredPackages);
  console.log(output);

  if (hasIssues(analysisResult)) {
    process.exit(1);
  }
};

main();
