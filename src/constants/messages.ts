export const MESSAGES = {
  REPORT_TITLE: 'Dependency Analysis Report',
  UNUSED_TITLE: 'Unused Dependencies:',
  UNUSED_SUBTITLE: '(declared but not imported in source code)',
  UNUSED_PEER_TITLE: 'Unused peerDependencies:',
  UNUSED_PEER_SUBTITLE: '(declared as a consumer contract but not imported in source code)',
  MISPLACED_TITLE: 'Misplaced Dependencies:',
  MISPLACED_SUBTITLE: '(in devDependencies but used in source code)',
  TYPE_ONLY_TITLE: 'Type-Only Imports:',
  TYPE_ONLY_SUBTITLE: '(used only for type definitions)',
  TOTAL_ISSUES: 'Total Issues:',
  NO_ISSUES: '✓ No issues found! All dependencies are properly used.',
  IGNORED_PACKAGES: 'Ignored packages:',
  USED_IN_FILES: (count: number) => (count === 1 ? 'used in 1 file' : `used in ${count} files`),
  SEPARATOR: '━'.repeat(60),
  PACKAGE_JSON_NOT_FOUND: (path: string) =>
    `package.json not found at ${path}. Pass the project directory as an argument, or run deps-finder from it.`,
  PACKAGE_JSON_PARSE_ERROR: (path: string, message: string) =>
    `Failed to parse ${path}: ${message}`,
  PACKAGE_JSON_READ_ERROR: (path: string, message: string) => `Failed to read ${path}: ${message}`,
  NOT_FOUND: 'not found',
  STYLE_BLOCK_OF: (path: string) => `the <style> block of ${path}`,
  PARSE_FAILED_AT: (reason: string, line: number) => `${reason} at line ${line}`,
  SOURCE_SKIPPED: (path: string, reason: string) =>
    `warning: skipped ${path} (${reason}); its imports are not counted.`,
  SOURCE_PARTLY_PARSED: (path: string, reason: string) =>
    `warning: could not fully parse ${path} (${reason}); imports the parser could not recover are not counted.`,
  INPUT_SKIPPED: (path: string, reason: string) =>
    `warning: could not use ${path} (${reason}); the scan went on without it.`,
  PACKAGE_LEFT_OUT: (path: string) =>
    `note: left out ${path}, a workspace member or a package with its own install; run deps-finder there to check it.`,
  NOT_INSTALLED: (path: string) =>
    `note: no declared package is installed in a node_modules at or above ${path}; script commands were matched to packages by name, and peer dependencies were not checked.`,
} as const;

export const CLI_TEXT = {
  COMMAND: 'Find unused and misplaced dependencies in a package.json project.',
  ROOT: 'Project directory containing package.json (default: current directory)',
  TEXT: 'Output as text (default)',
  JSON: 'Output as JSON',
  ALL: 'Also report unused devDependencies and peerDependencies (misplaced checks stay on)',
  CHECK_PEER: 'Also check peerDependencies (off by default; on with --all)',
  IGNORE: 'Ignore packages (comma-separated, repeatable)',
  EXCLUDE: 'Exclude files/dirs by .gitignore-style pattern (comma-separated, repeatable)',
  NO_AUTO_DETECT: 'Disable automatic build directory detection',
} as const;
