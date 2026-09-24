import path from 'node:path';
import { Array, Match, Option, Record, pipe } from 'effect';
import type { StyleSyntax } from './stylesheet-parser.js';

// text: the whole component with everything outside the block blanked and its line breaks kept,
// so offsets and line numbers stay the component's.
type Blanked = { readonly text: string };

// parsedAs: the extension to parse the block as.
export type ScriptBlock = Blanked & { readonly parsedAs: string };

export type StyleBlock = Blanked & { readonly syntax: StyleSyntax };

type Tag = { readonly start: number; readonly end: number; readonly lang: Option.Option<string> };

// An attribute value can hold a '>', as in Vue's generic="T extends Record<string, any>".
const tagPattern = (name: string): RegExp =>
  new RegExp(`(<${name}\\b((?:[^>"']|"[^"]*"|'[^']*')*)>)([\\s\\S]*?)<\\/${name}\\s*>`, 'gi');

const SCRIPT = tagPattern('script');

const STYLE = tagPattern('style');

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

const tagsIn = (pattern: RegExp, content: string): ReadonlyArray<Tag> =>
  Array.map([...content.matchAll(pattern)], (tag) => {
    const [, opening = '', attributes = '', body = ''] = tag;
    const start = tag.index + opening.length;
    return {
      start,
      end: start + body.length,
      lang: Option.map(Option.fromNullishOr(LANG.exec(attributes)?.[1]), (lang) =>
        lang.toLowerCase(),
      ),
    };
  });

const scriptTags =
  (defaultExtension: string) =>
  (content: string): ReadonlyArray<ScriptBlock> =>
    Array.map(tagsIn(SCRIPT, content), (tag) => ({
      text: blankedAt(content, tag),
      parsedAs: pipe(
        tag.lang,
        Option.flatMap((lang) => Record.get(EXTENSION_BY_LANG, lang)),
        Option.getOrElse(() => defaultExtension),
      ),
    }));

// Astro runs the frontmatter as TypeScript at build time, and bundles its script tags.
const astroScripts = (content: string): ReadonlyArray<ScriptBlock> => [
  ...pipe(
    Option.fromNullishOr(FRONTMATTER.exec(content)),
    Option.map((frontmatter): ScriptBlock => {
      const start = (frontmatter[1] ?? '').length;
      return {
        text: blankedAt(content, { start, end: start + (frontmatter[2] ?? '').length }),
        parsedAs: '.ts',
      };
    }),
    Option.toArray,
  ),
  ...scriptTags('.ts')(content),
];

export const componentScripts = (file: string, content: string): ReadonlyArray<ScriptBlock> =>
  Match.value(path.extname(file)).pipe(
    Match.whenOr('.vue', '.svelte', () => scriptTags('.js')(content)),
    Match.when('.astro', () => astroScripts(content)),
    Match.orElse((): ReadonlyArray<ScriptBlock> => []),
  );

export const componentStyles = (content: string): ReadonlyArray<StyleBlock> =>
  pipe(
    tagsIn(STYLE, content),
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
