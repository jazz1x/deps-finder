import path from 'node:path';
import { Array, Match } from 'effect';
import { MESSAGES } from '../constants/messages.js';
import type { AnalysisResult, DependencyUsage, OutputFormat } from '../domain/types.js';

const ANSI = {
  reset: '\x1b[0m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
} as const;

type Color = Exclude<keyof typeof ANSI, 'reset'>;

export type Paint = (text: string, color: Color) => string;

export const ansi: Paint = (text, color) => `${ANSI[color]}${text}${ANSI.reset}`;

export const plain: Paint = (text) => text;

export const paintFor = (isTerminal: boolean, noColor: string | undefined): Paint =>
  isTerminal && (noColor ?? '') === '' ? ansi : plain;

const whenAny = <A>(
  items: ReadonlyArray<A>,
  render: (items: ReadonlyArray<A>) => ReadonlyArray<string>,
): ReadonlyArray<string> => (Array.isReadonlyArrayNonEmpty(items) ? render(items) : []);

const formatIssueSection =
  (paint: Paint) =>
  (title: string, subtitle: string, items: ReadonlyArray<string>): ReadonlyArray<string> =>
    whenAny(items, (names) => [
      '',
      `${paint('⚠', 'yellow')}  ${paint(title, 'yellow')}`,
      `  ${paint(subtitle, 'gray')}`,
      '',
      ...Array.map(names, (name) => `  ${paint('•', 'yellow')} ${name}`),
    ]);

const formatUsage =
  (paint: Paint) =>
  (usage: DependencyUsage): ReadonlyArray<string> => {
    const usageText = MESSAGES.USED_IN_FILES(
      Array.dedupe(Array.map(usage.locations, (loc) => loc.file)).length,
    );
    return [
      `  ${paint('•', 'yellow')} ${usage.packageName} ${paint(`(${usageText})`, 'gray')}`,
      ...Array.flatMap(usage.locations, (loc) => [
        `    └─ ${path.relative(process.cwd(), loc.file)}:${loc.line}`,
        `       ${paint(loc.importStatement, 'gray')}`,
      ]),
    ];
  };

const formatMisplacedSection =
  (paint: Paint) =>
  (title: string, subtitle: string, items: ReadonlyArray<DependencyUsage>): ReadonlyArray<string> =>
    whenAny(items, (usages) => [
      '',
      `${paint('⚠', 'yellow')}  ${paint(title, 'yellow')}`,
      `  ${paint(subtitle, 'gray')}`,
      '',
      ...Array.flatMap(usages, formatUsage(paint)),
    ]);

const formatTypeOnlySection =
  (paint: Paint) =>
  (title: string, subtitle: string, items: ReadonlyArray<string>): ReadonlyArray<string> =>
    whenAny(items, (names) => [
      '',
      `${paint('ℹ️', 'blue')}  ${paint(title, 'blue')}`,
      `  ${paint(subtitle, 'gray')}`,
      '',
      ...Array.map(names, (name) => `  ${paint('○', 'blue')} ${name}`),
    ]);

const formatIgnored =
  (paint: Paint) =>
  (packages: ReadonlyArray<string>): ReadonlyArray<string> =>
    whenAny(packages, (names) => [
      '',
      `ℹ️  ${MESSAGES.IGNORED_PACKAGES} ${paint(Array.join(names, ', '), 'cyan')}`,
    ]);

const formatNoIssues = (paint: Paint): ReadonlyArray<string> => [
  paint(MESSAGES.SEPARATOR, 'gray'),
  '',
  `  ${paint(MESSAGES.NO_ISSUES, 'green')}`,
  '',
  paint(MESSAGES.SEPARATOR, 'gray'),
];

const formatIssues =
  (paint: Paint) =>
  (result: AnalysisResult): ReadonlyArray<string> => [
    ...formatIssueSection(paint)(MESSAGES.UNUSED_TITLE, MESSAGES.UNUSED_SUBTITLE, result.unused),
    ...formatIssueSection(paint)(
      MESSAGES.UNUSED_PEER_TITLE,
      MESSAGES.UNUSED_PEER_SUBTITLE,
      result.unusedPeer,
    ),
    ...formatMisplacedSection(paint)(
      MESSAGES.MISPLACED_TITLE,
      MESSAGES.MISPLACED_SUBTITLE,
      result.misplaced,
    ),
    ...formatTypeOnlySection(paint)(
      MESSAGES.TYPE_ONLY_TITLE,
      MESSAGES.TYPE_ONLY_SUBTITLE,
      result.typeOnly,
    ),
    '',
    paint(MESSAGES.SEPARATOR, 'gray'),
    `  ${MESSAGES.TOTAL_ISSUES} ${paint(String(result.totalIssues), 'yellow')}`,
    paint(MESSAGES.SEPARATOR, 'gray'),
  ];

export const report = (
  result: AnalysisResult,
  format: OutputFormat,
  ignoredPackages: ReadonlyArray<string>,
  paint: Paint,
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
        paint(MESSAGES.SEPARATOR, 'gray'),
        `  ${paint(MESSAGES.REPORT_TITLE, 'cyan')}`,
        paint(MESSAGES.SEPARATOR, 'gray'),
        ...formatIgnored(paint)(ignoredPackages),
        ...(result.totalIssues === 0 ? formatNoIssues(paint) : formatIssues(paint)(result)),
      ].join('\n'),
    ),
    Match.exhaustive,
  );

export const hasIssues = (result: AnalysisResult): boolean => result.totalIssues > 0;
