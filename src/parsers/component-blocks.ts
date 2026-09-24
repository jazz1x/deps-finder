import path from 'node:path';
import { Array, Data, Match, Option, Record, pipe } from 'effect';
import type { StyleSyntax } from './stylesheet-parser.js';

// text: the whole component with everything outside the block blanked and its line breaks kept,
// so offsets and line numbers stay the component's.
type Blanked = { readonly text: string };

// parsedAs: the extension to parse the block as.
type ScriptBlock = Blanked & { readonly parsedAs: string };

type StyleBlock = Blanked & { readonly syntax: StyleSyntax };

type Tag = {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly lang: Option.Option<string>;
};

type Token = Data.TaggedEnum<{
  Skipped: {};
  Block: { readonly tag: Tag };
  TemplateOpened: {};
  TemplateClosed: {};
}>;

const Token = Data.taggedEnum<Token>();

// An attribute value can hold a '>', as in Vue's generic="T extends Record<string, any>". A
// self-closing <script src="..." /> ends at its '/>' and matches no block.
const ATTRIBUTES = `(?:[^>"'/]|/(?!>)|"[^"]*"|'[^']*')*`;

// One pass from the left, so a tag inside a comment or inside another block's body is consumed
// with it.
const TOKEN = new RegExp(
  [
    '<!--[\\s\\S]*?-->',
    `(<(script|style)\\b(${ATTRIBUTES})>)([\\s\\S]*?)<\\/\\2\\s*>`,
    `<(/?)template\\b${ATTRIBUTES}>`,
  ].join('|'),
  'gi',
);

const LANG = /\blang\s*=\s*["']?([\w-]+)/i;

const FRONTMATTER = /^(\s*---\r?\n)([\s\S]*?)\r?\n---/;

const EXTENSION_BY_LANG: Readonly<Record<string, string>> = {
  js: '.js',
  javascript: '.js',
  jsx: '.jsx',
  ts: '.ts',
  typescript: '.ts',
  tsx: '.tsx',
};

// Indented Sass and Stylus are not read.
const SYNTAX_BY_LANG: Readonly<Record<string, StyleSyntax>> = {
  css: 'css',
  postcss: 'css',
  pcss: 'css',
  scss: 'scss',
  less: 'less',
};

const blank = (text: string): string => text.replace(/[^\n]/g, ' ');

const blankedAt = (content: string, { start, end }: Pick<Tag, 'start' | 'end'>): string =>
  blank(content.slice(0, start)) + content.slice(start, end) + blank(content.slice(end));

const tokenOf = (match: RegExpExecArray): Token => {
  const [, opening, name = '', attributes = '', body = '', slash] = match;
  const start = match.index + (opening ?? '').length;
  return Match.value({ opening, slash }).pipe(
    Match.when({ opening: Match.string }, () =>
      Token.Block({
        tag: {
          name: name.toLowerCase(),
          start,
          end: start + body.length,
          lang: Option.map(Option.fromNullishOr(LANG.exec(attributes)?.[1]), (lang) =>
            lang.toLowerCase(),
          ),
        },
      }),
    ),
    Match.when({ slash: '/' }, () => Token.TemplateClosed()),
    Match.when({ slash: '' }, () => Token.TemplateOpened()),
    Match.orElse(() => Token.Skipped()),
  );
};

type Scan = { readonly depth: number; readonly tags: ReadonlyArray<Tag> };

// Vue reads only top-level blocks; a <script> in the template is markup.
const step = (scan: Scan, token: Token): Scan =>
  Token.$match(token, {
    Skipped: () => scan,
    Block: ({ tag }) => ({
      ...scan,
      tags: Array.appendAll(
        scan.tags,
        Array.filter([tag], () => scan.depth === 0),
      ),
    }),
    TemplateOpened: () => ({ ...scan, depth: scan.depth + 1 }),
    TemplateClosed: () => ({ ...scan, depth: Math.max(0, scan.depth - 1) }),
  });

const OUTSIDE_TEMPLATE: Scan = { depth: 0, tags: [] };

const topLevelTags = (markup: string): ReadonlyArray<Tag> =>
  Array.reduce(Array.map([...markup.matchAll(TOKEN)], tokenOf), OUTSIDE_TEMPLATE, step).tags;

const tagsNamed = (name: string, markup: string): ReadonlyArray<Tag> =>
  Array.filter(topLevelTags(markup), (tag) => tag.name === name);

const scriptBlocks = (
  content: string,
  markup: string,
  defaultExtension: string,
): ReadonlyArray<ScriptBlock> =>
  Array.map(tagsNamed('script', markup), (tag) => ({
    text: blankedAt(content, tag),
    parsedAs: pipe(
      tag.lang,
      Option.flatMap((lang) => Record.get(EXTENSION_BY_LANG, lang)),
      Option.getOrElse(() => defaultExtension),
    ),
  }));

type Frontmatter = { readonly start: number; readonly end: number };

const frontmatterOf = (content: string): Option.Option<Frontmatter> =>
  Option.map(Option.fromNullishOr(FRONTMATTER.exec(content)), (found) => {
    const start = (found[1] ?? '').length;
    return { start, end: start + (found[2] ?? '').length };
  });

// Astro runs the frontmatter as TypeScript at build time, and bundles its script tags.
const astroScripts = (content: string): ReadonlyArray<ScriptBlock> => {
  const frontmatter = frontmatterOf(content);
  const markup = Option.match(frontmatter, {
    onNone: () => content,
    onSome: ({ end }) => blank(content.slice(0, end)) + content.slice(end),
  });
  return [
    ...Array.map(Option.toArray(frontmatter), (range): ScriptBlock => ({
      text: blankedAt(content, range),
      parsedAs: '.ts',
    })),
    ...scriptBlocks(content, markup, '.ts'),
  ];
};

// The package a component's compiled output imports.
const FRAMEWORK_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.astro': 'astro',
};

export const componentFramework = (file: string): Option.Option<string> =>
  Record.get(FRAMEWORK_BY_EXTENSION, path.extname(file));

export const componentScripts = (file: string, content: string): ReadonlyArray<ScriptBlock> =>
  Match.value(path.extname(file)).pipe(
    Match.whenOr('.vue', '.svelte', () => scriptBlocks(content, content, '.js')),
    Match.when('.astro', () => astroScripts(content)),
    Match.orElse((): ReadonlyArray<ScriptBlock> => []),
  );

export const componentStyles = (content: string): ReadonlyArray<StyleBlock> =>
  pipe(
    tagsNamed('style', content),
    Array.map((tag) =>
      Option.map(
        Option.match(tag.lang, {
          onNone: () => Option.some<StyleSyntax>('css'),
          onSome: (lang) => Record.get(SYNTAX_BY_LANG, lang),
        }),
        (syntax): StyleBlock => ({ text: blankedAt(content, tag), syntax }),
      ),
    ),
    Array.getSomes,
  );
