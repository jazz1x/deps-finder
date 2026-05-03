import path from 'node:path';
import { A } from '@mobily/ts-belt';
import { P, match } from 'ts-pattern';
import { MESSAGES } from '../constants/messages.js';
import type { AnalysisResult, DependencyUsage, OutputFormat } from '../domain/types.js';

const colors = {
  reset: '\x1b[0m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  blue: '\x1b[34m', // Added blue for type-only
} as const;

const colorize = (text: string, color: keyof typeof colors): string =>
  `${colors[color]}${text}${colors.reset}`;

const formatIssueSection = (
  title: string,
  subtitle: string,
  items: ReadonlyArray<string>,
): string[] => {
  return match(items)
    .with([], () => [])
    .otherwise((it) => [
      '',
      `${colorize('⚠', 'yellow')}  ${colorize(title, 'yellow')}`,
      `  ${colorize(subtitle, 'gray')}`,
      '',
      ...A.map(it, (item) => `  ${colorize('•', 'yellow')} ${item}`),
    ]);
};

const formatMisplacedSection = (
  title: string,
  subtitle: string,
  items: ReadonlyArray<DependencyUsage>,
): string[] => {
  return match(items)
    .with([], () => [])
    .otherwise((it) => [
      '',
      `${colorize('⚠', 'yellow')}  ${colorize(title, 'yellow')}`,
      `  ${colorize(subtitle, 'gray')}`,
      '',
      ...A.flatMap(it, (item) => {
        const locationCount = item.locations.length;
        const usageText = locationCount === 1 ? 'used in 1 file' : `used in ${locationCount} files`;
        return [
          `  ${colorize('•', 'yellow')} ${item.packageName} ${colorize(`(${usageText})`, 'gray')}`,
          ...A.flatMap(item.locations, (loc) => {
            const relativePath = path.relative(process.cwd(), loc.file);
            return [
              `    └─ ${relativePath}:${loc.line}`,
              `       ${colorize(loc.importStatement, 'gray')}`,
            ];
          }),
        ];
      }),
    ]);
};

const formatTypeOnlySection = (
  title: string,
  subtitle: string,
  items: ReadonlyArray<string>,
): string[] => {
  return match(items)
    .with([], () => [])
    .otherwise((it) => [
      '',
      `${colorize('ℹ️', 'blue')}  ${colorize(title, 'blue')}`,
      `  ${colorize(subtitle, 'gray')}`,
      '',
      ...A.map(it, (item) => `  ${colorize('○', 'blue')} ${item}`),
    ]);
};

const formatIgnored = (packages: ReadonlyArray<string>): string[] => {
  return match(packages)
    .with([], () => [])
    .otherwise((pkgs) => {
      const packageList = A.join(pkgs, ', ');
      return ['', `ℹ️  ${MESSAGES.IGNORED_PACKAGES} ${colorize(packageList, 'cyan')}`];
    });
};

const formatSeparator = (): string => colorize(MESSAGES.SEPARATOR, 'gray');

const formatNoIssues = (): string[] => [
  formatSeparator(),
  '',
  `  ${colorize(MESSAGES.NO_ISSUES, 'green')}`,
  '',
  formatSeparator(),
];

const formatSummary = (totalIssues: number): string[] => [
  '',
  formatSeparator(),
  `  ${MESSAGES.TOTAL_ISSUES} ${colorize(String(totalIssues), 'yellow')}`,
  formatSeparator(),
];

export const report = (
  result: AnalysisResult,
  format: OutputFormat,
  ignoredPackages: ReadonlyArray<string> = [],
): string => {
  return match(format)
    .with('json', () =>
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
    )
    .with('text', () => {
      return match({ result, ignoredPackages })
        .with(
          {
            result: { totalIssues: 0 },
            ignoredPackages: P.any,
          },
          ({ ignoredPackages }) =>
            [
              '',
              formatSeparator(),
              `  ${colorize(MESSAGES.REPORT_TITLE, 'cyan')}`,
              formatSeparator(),
              ...formatIgnored(ignoredPackages),
              ...formatNoIssues(),
            ].join('\n'),
        )
        .otherwise(({ result, ignoredPackages }) =>
          [
            '',
            formatSeparator(),
            `  ${colorize(MESSAGES.REPORT_TITLE, 'cyan')}`,
            formatSeparator(),
            ...formatIgnored(ignoredPackages),
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
            ...formatTypeOnlySection(
              MESSAGES.TYPE_ONLY_TITLE,
              MESSAGES.TYPE_ONLY_SUBTITLE,
              result.typeOnly,
            ),
            ...formatSummary(result.totalIssues),
          ].join('\n'),
        );
    })
    .exhaustive();
};

export const hasIssues = (result: AnalysisResult): boolean => result.totalIssues > 0;
