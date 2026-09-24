import path from 'node:path';
import { Array, Data, Match, Option, Record, pipe } from 'effect';
import type { StyleSyntax } from './stylesheet-parser.js';

// text: the whole component with everything outside the block blanked and its line breaks kept,
// so offsets and line numbers stay the component's.
type Blanked = { readonly text: string };

// parsedAs: the extension to parse the block as.
type ScriptBlock = Blanked & { readonly parsedAs: string };

type StyleBlock = Blanked & { readonly syntax: StyleSyntax };

type ComponentBlocks = {
  readonly scripts: ReadonlyArray<ScriptBlock>;
  readonly styles: ReadonlyArray<StyleBlock>;
};

type Range = { readonly start: number; readonly end: number };

type Tag = Range & { readonly name: string; readonly lang: Option.Option<string> };

// Raw: the body is text up to the closing tag. Template: HTML, whose closing tag is the one that
// matches its nesting. Inline: a tag in markup, whose body is more markup.
type Body = Data.TaggedEnum<{ Raw: {}; Template: {}; Inline: {} }>;

const Body = Data.taggedEnum<Body>();

// Vue treats every top-level element as a block, and reads all but a HTML <template> as raw text.
const vueBody = (name: string, lang: Option.Option<string>): Body =>
  Match.value({ name, lang: Option.getOrElse(lang, () => 'html') }).pipe(
    Match.when({ name: 'template', lang: 'html' }, () => Body.Template()),
    Match.orElse(() => Body.Raw()),
  );

const markupBody = (name: string): Body =>
  Match.value(name).pipe(
    Match.whenOr('script', 'style', () => Body.Raw()),
    Match.orElse(() => Body.Inline()),
  );

// An attribute value can hold a '>', as in Vue's generic="T extends Record<string, any>". A
// self-closing <script src="..." /> ends at its '/>' and has no body.
const ATTRIBUTES = `(?:[^>"'/]|/(?!>)|"[^"]*"|'[^']*')*`;

const COMMENT = '<!--[\\s\\S]*?-->';

const NAME = '[a-zA-Z][\\w:-]*';

const OPENING_TAG = new RegExp(
  `${COMMENT}|<${NAME}${ATTRIBUTES}/>|<(${NAME})(${ATTRIBUTES})>`,
  'g',
);

// A '<template' in an interpolation or an attribute value is consumed with it.
const TEMPLATE_TOKEN = new RegExp(
  [
    COMMENT,
    '\\{\\{[\\s\\S]*?\\}\\}',
    `<(/?)template(?=[\\s/>])${ATTRIBUTES}>`,
    `</?${NAME}${ATTRIBUTES}/?>`,
  ].join('|'),
  'g',
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

// A fresh copy per search, so the shared pattern's lastIndex never carries over.
const matchesFrom = (pattern: RegExp, text: string, from: number) => {
  const search = new RegExp(pattern.source, pattern.flags);
  search.lastIndex = from;
  return text.matchAll(search);
};

const firstFrom = (pattern: RegExp, text: string, from: number): Option.Option<RegExpExecArray> =>
  Option.fromIterable(matchesFrom(pattern, text, from));

const endOf = (match: RegExpExecArray): number => match.index + match[0].length;

const nestingOf = (token: RegExpExecArray): number =>
  Match.value(token[1]).pipe(
    Match.when('', () => 1),
    Match.when('/', () => -1),
    Match.orElse(() => 0),
  );

const templateClose = (content: string, from: number): Option.Option<RegExpExecArray> => {
  const tokens = [...matchesFrom(TEMPLATE_TOKEN, content, from)];
  return pipe(
    Array.scan(tokens, 1, (depth, token) => depth + nestingOf(token)),
    Array.findFirstIndex((depth) => depth === 0),
    Option.flatMap((closed) => Array.get(tokens, closed - 1)),
  );
};

const rawClose = (content: string, name: string, from: number): Option.Option<RegExpExecArray> =>
  firstFrom(new RegExp(`</${name}\\s*>`, 'gi'), content, from);

type Step = readonly [Option.Option<Tag>, number];

// An unclosed block runs to the end, as in Vue.
const blockThrough = (
  content: string,
  tag: Omit<Tag, 'end'>,
  close: Option.Option<RegExpExecArray>,
): Step =>
  Option.match(close, {
    onNone: () => [Option.some({ ...tag, end: content.length }), content.length],
    onSome: (found) => [Option.some({ ...tag, end: found.index }), endOf(found)],
  });

type BodyOf = (name: string, lang: Option.Option<string>) => Body;

const langOf = (attributes: string): Option.Option<string> =>
  Option.map(Option.fromNullishOr(LANG.exec(attributes)?.[1]), (lang) => lang.toLowerCase());

const opened = (markup: string, bodyOf: BodyOf, tag: Omit<Tag, 'end'>): Step =>
  Body.$match(bodyOf(tag.name, tag.lang), {
    Raw: () => blockThrough(markup, tag, rawClose(markup, tag.name, tag.start)),
    Template: () => blockThrough(markup, tag, templateClose(markup, tag.start)),
    Inline: (): Step => [Option.none(), tag.start],
  });

// One step from `from` to the next top-level tag: the block it opens, if any, and where to go on.
// A comment or a self-closing tag names nothing.
const nextBlock =
  (markup: string, bodyOf: BodyOf) =>
  (from: number): Option.Option<Step> =>
    Option.map(firstFrom(OPENING_TAG, markup, from), (found) =>
      Option.match(Option.fromNullishOr(found[1]), {
        onNone: (): Step => [Option.none(), endOf(found)],
        onSome: (name) =>
          opened(markup, bodyOf, {
            name: name.toLowerCase(),
            start: endOf(found),
            lang: langOf(found[2] ?? ''),
          }),
      }),
    );

const topLevelTags = (markup: string, bodyOf: BodyOf): ReadonlyArray<Tag> =>
  Array.getSomes(Array.unfold(0, nextBlock(markup, bodyOf)));

const blank = (text: string): string => text.replace(/[^\n]/g, ' ');

const blankedAt = (content: string, { start, end }: Range): string =>
  blank(content.slice(0, start)) + content.slice(start, end) + blank(content.slice(end));

const scriptOf =
  (content: string, defaultExtension: string) =>
  (tag: Tag): ScriptBlock => ({
    text: blankedAt(content, tag),
    parsedAs: pipe(
      tag.lang,
      Option.flatMap((lang) => Record.get(EXTENSION_BY_LANG, lang)),
      Option.getOrElse(() => defaultExtension),
    ),
  });

const styleOf =
  (content: string) =>
  (tag: Tag): Option.Option<StyleBlock> =>
    Option.map(
      Option.match(tag.lang, {
        onNone: () => Option.some<StyleSyntax>('css'),
        onSome: (lang) => Record.get(SYNTAX_BY_LANG, lang),
      }),
      (syntax): StyleBlock => ({ text: blankedAt(content, tag), syntax }),
    );

// markup: the component with the parts that are not markup, such as Astro's frontmatter, blanked.
const blocksIn = (
  content: string,
  markup: string,
  bodyOf: BodyOf,
  defaultExtension: string,
): ComponentBlocks => {
  const tags = topLevelTags(markup, bodyOf);
  return {
    scripts: pipe(
      Array.filter(tags, (tag) => tag.name === 'script'),
      Array.map(scriptOf(content, defaultExtension)),
    ),
    styles: pipe(
      Array.filter(tags, (tag) => tag.name === 'style'),
      Array.map(styleOf(content)),
      Array.getSomes,
    ),
  };
};

const frontmatterOf = (content: string): Option.Option<Range> =>
  Option.map(Option.fromNullishOr(FRONTMATTER.exec(content)), (found) => {
    const start = (found[1] ?? '').length;
    return { start, end: start + (found[2] ?? '').length };
  });

// Astro runs the frontmatter as TypeScript at build time, and bundles its script tags.
const astroBlocks = (content: string): ComponentBlocks => {
  const frontmatter = frontmatterOf(content);
  const markup = Option.match(frontmatter, {
    onNone: () => content,
    onSome: ({ end }) => blank(content.slice(0, end)) + content.slice(end),
  });
  const blocks = blocksIn(content, markup, markupBody, '.ts');
  return {
    ...blocks,
    scripts: [
      ...Array.map(Option.toArray(frontmatter), (range): ScriptBlock => ({
        text: blankedAt(content, range),
        parsedAs: '.ts',
      })),
      ...blocks.scripts,
    ],
  };
};

// The package a component's compiled output imports.
const FRAMEWORK_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.astro': 'astro',
};

export const componentFramework = (file: string): Option.Option<string> =>
  Record.get(FRAMEWORK_BY_EXTENSION, path.extname(file));

export const componentBlocks = (file: string, content: string): ComponentBlocks =>
  Match.value(path.extname(file)).pipe(
    Match.when('.vue', () => blocksIn(content, content, vueBody, '.js')),
    Match.when('.svelte', () => blocksIn(content, content, markupBody, '.js')),
    Match.when('.astro', () => astroBlocks(content)),
    Match.orElse((): ComponentBlocks => ({ scripts: [], styles: [] })),
  );
