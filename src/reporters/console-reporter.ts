import path from 'node:path';
import { A } from '@mobily/ts-belt';
import { P, match } from 'ts-pattern';
import { MESSAGES } from '../constants/messages.js';
import type { AnalysisResult, DependencyUsage, OutputFormat } from '../domain/types.js';

/**
 * 색상 코드
 */
const colors = {
  reset: '\x1b[0m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  blue: '\x1b[34m', // Added blue for type-only
} as const;

/**
 * 색상 적용
 */
const colorize = (text: string, color: keyof typeof colors): string =>
  `${colors[color]}${text}${colors.reset}`;

/**
 * 섹션 헤더 출력 (for Unused)
 */
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

/**
 * 섹션 헤더 출력 (for Misplaced with details)
 */
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
      ...A.reduce(it, [] as string[], (acc, item) => {
        const locationCount = item.locations.length;
        const usageText = locationCount === 1 ? 'used in 1 file' : `used in ${locationCount} files`;

        acc.push(
          `  ${colorize('•', 'yellow')} ${item.packageName} ${colorize(`(${usageText})`, 'gray')}`,
        );

        A.forEach(item.locations, (loc) => {
          const relativePath = path.relative(process.cwd(), loc.file);
          acc.push(`    └─ ${relativePath}:${loc.line}`);
          acc.push(`       ${colorize(loc.importStatement, 'gray')}`);
        });
        return acc;
      }),
    ]);
};

/**
 * 섹션 헤더 출력 (for Type-Only)
 */
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

/**
 * 무시된 패키지 출력
 */
const formatIgnored = (packages: ReadonlyArray<string>): string[] => {
  return match(packages)
    .with([], () => [])
    .otherwise((pkgs) => {
      const packageList = A.join(pkgs, ', ');
      return ['', `ℹ️  ${MESSAGES.IGNORED_PACKAGES} ${colorize(packageList, 'cyan')}`];
    });
};

/**
 * 구분선 출력
 */
const formatSeparator = (): string => colorize(MESSAGES.SEPARATOR, 'gray');

/**
 * 이슈 없음 메시지 출력
 */
const formatNoIssues = (): string[] => [
  formatSeparator(),
  '',
  `  ${colorize(MESSAGES.NO_ISSUES, 'green')}`,
  '',
  formatSeparator(),
];

/**
 * 이슈 요약 출력
 */
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
            result: { totalIssues: 0, typeOnly: [] },
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
