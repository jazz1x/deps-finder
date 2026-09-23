import path from 'node:path';
import { Array, Match } from 'effect';
import { MESSAGES } from '../constants/messages.js';
import type { AnalysisResult, DependencyUsage, OutputFormat } from '../domain/types.js';

const colors = {
  reset: '\x1b[0m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
} as const;

const colorize = (text: string, color: keyof typeof colors): string =>
  `${colors[color]}${text}${colors.reset}`;

const whenAny = <A>(
  items: ReadonlyArray<A>,
  render: (items: ReadonlyArray<A>) => ReadonlyArray<string>,
): ReadonlyArray<string> => (Array.isReadonlyArrayNonEmpty(items) ? render(items) : []);

const formatIssueSection = (
  title: string,
  subtitle: string,
  items: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  whenAny(items, (names) => [
    '',
    `${colorize('⚠', 'yellow')}  ${colorize(title, 'yellow')}`,
    `  ${colorize(subtitle, 'gray')}`,
    '',
    ...Array.map(names, (name) => `  ${colorize('•', 'yellow')} ${name}`),
  ]);

const formatUsage = (usage: DependencyUsage): ReadonlyArray<string> => {
  const count = usage.locations.length;
  const usageText = count === 1 ? 'used in 1 file' : `used in ${count} files`;
  return [
    `  ${colorize('•', 'yellow')} ${usage.packageName} ${colorize(`(${usageText})`, 'gray')}`,
    ...Array.flatMap(usage.locations, (loc) => [
      `    └─ ${path.relative(process.cwd(), loc.file)}:${loc.line}`,
      `       ${colorize(loc.importStatement, 'gray')}`,
    ]),
  ];
};

const formatMisplacedSection = (
  title: string,
  subtitle: string,
  items: ReadonlyArray<DependencyUsage>,
): ReadonlyArray<string> =>
  whenAny(items, (usages) => [
    '',
    `${colorize('⚠', 'yellow')}  ${colorize(title, 'yellow')}`,
    `  ${colorize(subtitle, 'gray')}`,
    '',
    ...Array.flatMap(usages, formatUsage),
  ]);

const formatTypeOnlySection = (
  title: string,
  subtitle: string,
  items: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  whenAny(items, (names) => [
    '',
    `${colorize('ℹ️', 'blue')}  ${colorize(title, 'blue')}`,
    `  ${colorize(subtitle, 'gray')}`,
    '',
    ...Array.map(names, (name) => `  ${colorize('○', 'blue')} ${name}`),
  ]);

const formatIgnored = (packages: ReadonlyArray<string>): ReadonlyArray<string> =>
  whenAny(packages, (names) => [
    '',
    `ℹ️  ${MESSAGES.IGNORED_PACKAGES} ${colorize(Array.join(names, ', '), 'cyan')}`,
  ]);

const formatSeparator = (): string => colorize(MESSAGES.SEPARATOR, 'gray');

const formatNoIssues = (): ReadonlyArray<string> => [
  formatSeparator(),
  '',
  `  ${colorize(MESSAGES.NO_ISSUES, 'green')}`,
  '',
  formatSeparator(),
];

const formatIssues = (result: AnalysisResult): ReadonlyArray<string> => [
  ...formatIssueSection(MESSAGES.UNUSED_TITLE, MESSAGES.UNUSED_SUBTITLE, result.unused),
  ...formatIssueSection(
    MESSAGES.UNUSED_PEER_TITLE,
    MESSAGES.UNUSED_PEER_SUBTITLE,
    result.unusedPeer,
  ),
  ...formatMisplacedSection(
    MESSAGES.MISPLACED_TITLE,
    MESSAGES.MISPLACED_SUBTITLE,
    result.misplaced,
  ),
  ...formatTypeOnlySection(MESSAGES.TYPE_ONLY_TITLE, MESSAGES.TYPE_ONLY_SUBTITLE, result.typeOnly),
  '',
  formatSeparator(),
  `  ${MESSAGES.TOTAL_ISSUES} ${colorize(String(result.totalIssues), 'yellow')}`,
  formatSeparator(),
];

export const report = (
  result: AnalysisResult,
  format: OutputFormat,
  ignoredPackages: ReadonlyArray<string> = [],
): string =>
  Match.value(format).pipe(
    Match.when('json', () =>
      JSON.stringify(
        {
          unused: result.unused,
          unusedPeer: result.unusedPeer,
          misplaced: result.misplaced,
          typeOnly: result.typeOnly,
          ignored: ignoredPackages,
          totalIssues: result.totalIssues,
        },
        null,
        2,
      ),
    ),
    Match.when('text', () =>
      [
        '',
        formatSeparator(),
        `  ${colorize(MESSAGES.REPORT_TITLE, 'cyan')}`,
        formatSeparator(),
        ...formatIgnored(ignoredPackages),
        ...(result.totalIssues === 0 ? formatNoIssues() : formatIssues(result)),
      ].join('\n'),
    ),
    Match.exhaustive,
  );

export const hasIssues = (result: AnalysisResult): boolean => result.totalIssues > 0;
