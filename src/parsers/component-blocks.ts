import path from 'node:path';
import { Array, Match, Option, Record, pipe } from 'effect';

// text: the whole component with everything outside the block blanked and its line breaks kept,
// so offsets and line numbers stay the component's. parsedAs: the extension to parse it as.
export type ScriptBlock = { readonly text: string; readonly parsedAs: string };

// An attribute value can hold a '>', as in Vue's generic="T extends Record<string, any>".
const SCRIPT = /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi;

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

const blank = (text: string): string => text.replace(/[^\n]/g, ' ');

const blockAt = (content: string, start: number, end: number, parsedAs: string): ScriptBlock => ({
  text: blank(content.slice(0, start)) + content.slice(start, end) + blank(content.slice(end)),
  parsedAs,
});

const scriptTags =
  (defaultExtension: string) =>
  (content: string): ReadonlyArray<ScriptBlock> =>
    Array.map([...content.matchAll(SCRIPT)], (tag) => {
      const attributes = tag[1] ?? '';
      const start = tag.index + '<script'.length + attributes.length + 1;
      return blockAt(
        content,
        start,
        start + (tag[2] ?? '').length,
        pipe(
          Option.fromNullishOr(LANG.exec(attributes)?.[1]),
          Option.flatMap((lang) => Record.get(EXTENSION_BY_LANG, lang.toLowerCase())),
          Option.getOrElse(() => defaultExtension),
        ),
      );
    });

// Astro runs the frontmatter as TypeScript at build time, and bundles its script tags.
const astroBlocks = (content: string): ReadonlyArray<ScriptBlock> => [
  ...pipe(
    Option.fromNullishOr(FRONTMATTER.exec(content)),
    Option.map((frontmatter) => {
      const start = (frontmatter[1] ?? '').length;
      return blockAt(content, start, start + (frontmatter[2] ?? '').length, '.ts');
    }),
    Option.toArray,
  ),
  ...scriptTags('.ts')(content),
];

export const componentScripts = (file: string, content: string): ReadonlyArray<ScriptBlock> =>
  Match.value(path.extname(file)).pipe(
    Match.whenOr('.vue', '.svelte', () => scriptTags('.js')(content)),
    Match.when('.astro', () => astroBlocks(content)),
    Match.orElse((): ReadonlyArray<ScriptBlock> => []),
  );
