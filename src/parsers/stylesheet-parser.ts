import { Array, Match, Option, Result, String, pipe } from 'effect';
import postcss, {
  type AtRule,
  type ChildNode,
  CssSyntaxError,
  type Document,
  type Root,
  type Rule,
} from 'postcss';
import postcssLess from 'postcss-less';
import postcssScss from 'postcss-scss';
import { FileError } from '../domain/errors.js';

export type StyleSyntax = 'css' | 'scss' | 'less';

type StyleReference = {
  readonly specifier: string;
  readonly line: number;
  readonly statement: string;
};

// Tailwind v4 loads packages with @plugin, @config and @reference; Sass with @use and @forward;
// Less with @plugin.
const LOADING_AT_RULES = ['import', 'use', 'forward', 'plugin', 'config', 'reference'];

// A Less option such as (reference) may come first; the target is quoted or in url().
const TARGET = /^\s*(?:\([^)]*\)\s*)?(?:(["'])(.*?)\1|url\(\s*(["']?)(.*?)\3\s*\))/;

const COMMA_OUTSIDE_PARENTHESES = /,(?![^(]*\))/;

// sass:math, data:, http:. Webpack's ~ prefix marks a package.
const SCHEME = /^[a-z][\w+.-]*:/i;

type StyleNode = Document | Root | ChildNode;

const parserOf = (syntax: StyleSyntax): ((css: string) => StyleNode) =>
  Match.value(syntax).pipe(
    Match.when('css', () => (css: string) => postcss.parse(css)),
    Match.when('scss', () => (css: string) => postcssScss.parse(css)),
    Match.when('less', () => (css: string) => postcssLess.parse(css)),
    Match.exhaustive,
  );

const isAtRule = (node: StyleNode): node is AtRule => node.type === 'atrule';

const isContainer = (node: StyleNode): node is Document | Root | Rule =>
  Array.contains(['document', 'root', 'rule'], node.type);

const atRulesIn = (node: StyleNode): ReadonlyArray<AtRule> =>
  Match.value(node).pipe(
    Match.when(isAtRule, (rule) => [rule, ...Array.flatMap(rule.nodes ?? [], atRulesIn)]),
    Match.when(isContainer, (container) =>
      Array.flatMap<StyleNode, AtRule>(container.nodes, atRulesIn),
    ),
    Match.orElse((): ReadonlyArray<AtRule> => []),
  );

// Sass and Less import a comma-separated list. A CSS media query after a comma is not quoted, so
// it matches no target.
const targetsOf = (params: string): ReadonlyArray<string> =>
  pipe(
    String.split(params, COMMA_OUTSIDE_PARENTHESES),
    Array.map((part) => Option.fromNullishOr(TARGET.exec(part))),
    Array.getSomes,
    Array.map((target) => target[2] ?? target[4] ?? ''),
    Array.map(String.replace(/^~/, '')),
    Array.filter((target) => String.isNonEmpty(target) && !SCHEME.test(target)),
  );

const referencesOf = (rule: AtRule): ReadonlyArray<StyleReference> =>
  Array.map(targetsOf(rule.params), (specifier) => ({
    specifier,
    // postcss sets source.start on every node it parses; only nodes built in code lack it.
    line: rule.source?.start?.line ?? 1,
    statement: `@${rule.name} ${rule.params}`,
  }));

export const stylesheetReferences = (
  file: string,
  content: string,
  syntax: StyleSyntax,
): Result.Result<ReadonlyArray<StyleReference>, FileError> =>
  pipe(
    Result.try({
      try: () => parserOf(syntax)(content),
      catch: (error) =>
        FileError.ParseFailed({
          path: file,
          reason: Match.value(error).pipe(
            Match.when(Match.instanceOf(CssSyntaxError), (failure) =>
              Option.match(Option.fromNullishOr(failure.line), {
                onNone: () => failure.reason,
                onSome: (line) => `${failure.reason} at line ${line}`,
              }),
            ),
            Match.orElse((other) => `${other}`),
          ),
        }),
    }),
    Result.map((root) =>
      pipe(
        atRulesIn(root),
        Array.filter((rule) => Array.contains(LOADING_AT_RULES, rule.name)),
        Array.flatMap(referencesOf),
      ),
    ),
  );
