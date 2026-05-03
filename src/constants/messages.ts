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
  SEPARATOR: '━'.repeat(60),
  PACKAGE_JSON_NOT_FOUND: (path: string) =>
    `package.json not found at ${path}. Run deps-finder from a directory containing package.json.`,
  PACKAGE_JSON_PARSE_ERROR: (path: string, message: string) =>
    `Failed to parse ${path}: ${message}`,
  PACKAGE_JSON_READ_ERROR: (path: string, message: string) => `Failed to read ${path}: ${message}`,
  WARNING_PREFIX: 'warning:',
} as const;

export const HELP_TEXT = `
Usage: deps-finder [options]

Options:
  -t, --text             Output as text (default)
  -j, --json             Output as JSON
  -a, --all              Check dependencies, peerDependencies, and devDependencies
  -p, --check-peer       Also check peerDependencies (off by default; on with --all)
  -i, --ignore <pkgs>    Ignore specific packages (comma-separated)
  -e, --exclude <globs>  Exclude specific files/dirs (comma-separated globs)
  --no-auto-detect       Disable automatic build directory detection
  -h, --help             Show this help message

Examples:
  deps-finder
  deps-finder --json
  deps-finder --all
  deps-finder --check-peer
  deps-finder --ignore eslint,prettier
  deps-finder --exclude "custom-dist/**,.cache/**"
  deps-finder -j --all
` as const;
