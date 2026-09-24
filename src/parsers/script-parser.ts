import path from 'node:path';
import { Array, Data, Match, Option, Result, String, pipe } from 'effect';
import type { Gathered, ScriptCommand } from '../domain/types.js';
import { gatherAll, gatherOptional, readDirectory, readFile } from '../utils/file-reader.js';

// binary: the next word is a binary. package: the next word is a binary, or a package to fetch
// and run. script: the next word is a script of the same package.json when it names one, else a
// binary. script-only: the next word is a script. separated: the command follows `--` when there
// is one. nested: the next word is a script of its own.
type Hands = 'binary' | 'package' | 'script' | 'script-only' | 'separated' | 'nested';

type Runner = { readonly words: ReadonlyArray<string>; readonly hands: Hands };

// Longer prefixes first: `pnpm exec` is not `pnpm` running a script named exec.
const RUNNERS: ReadonlyArray<Runner> = [
  { words: ['npx'], hands: 'package' },
  { words: ['npm', 'exec'], hands: 'package' },
  { words: ['pnpm', 'exec'], hands: 'binary' },
  { words: ['pnpm', 'dlx'], hands: 'package' },
  { words: ['yarn', 'exec'], hands: 'binary' },
  { words: ['yarn', 'dlx'], hands: 'package' },
  { words: ['bunx'], hands: 'package' },
  { words: ['bun', 'x'], hands: 'package' },
  { words: ['cross-env'], hands: 'binary' },
  { words: ['env'], hands: 'binary' },
  { words: ['dotenv'], hands: 'separated' },
  { words: ['sh'], hands: 'nested' },
  { words: ['bash'], hands: 'nested' },
  { words: ['npm', 'run'], hands: 'script-only' },
  { words: ['npm', 'run-script'], hands: 'script-only' },
  { words: ['pnpm', 'run'], hands: 'script-only' },
  { words: ['yarn', 'run'], hands: 'script' },
  { words: ['bun', 'run'], hands: 'script' },
  { words: ['bun'], hands: 'script' },
  { words: ['pnpm'], hands: 'script' },
  { words: ['yarn'], hands: 'script' },
];

// A comment, a word with its quoted parts, or a separator between commands.
const TOKEN = /#[^\n]*|(?:[^\s'"`;&|()]|'[^']*'|"(?:\\.|[^"\\])*")+|&&|\|\||[;&|()\n`]/g;

const SEPARATOR = /^(?:&&|\|\||[;&|()\n`])$/;

const QUOTES = /'([^']*)'|"((?:\\.|[^"\\])*)"/g;

// Words that open or close a shell construct before the command itself.
const KEYWORDS = [
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'do',
  'done',
  'while',
  'until',
  '!',
  'time',
  'exec',
  '{',
  '}',
];

const ENV_ASSIGNMENT = /^[A-Za-z_]\w*=/;

type Token = Data.TaggedEnum<{ Word: { readonly text: string }; Break: {} }>;

const Token = Data.taggedEnum<Token>();

const tokenOf = (text: string): ReadonlyArray<Token> =>
  Match.value(text).pipe(
    Match.when(String.startsWith('#'), (): ReadonlyArray<Token> => []),
    Match.when(
      (separator) => SEPARATOR.test(separator),
      () => [Token.Break()],
    ),
    Match.orElse((word) => [Token.Word({ text: String.replace(QUOTES, '$1$2')(word) })]),
  );

const segmentsOf = (script: string): ReadonlyArray<ReadonlyArray<string>> =>
  Array.reduce(
    Array.flatMap(Array.fromIterable(script.matchAll(TOKEN)), ([text]) => tokenOf(text)),
    Array.of<ReadonlyArray<string>>([]),
    (segments, token) =>
      Token.$match(token, {
        Break: () => Array.append(segments, []),
        Word: ({ text }) =>
          Array.append(
            Array.initNonEmpty(segments),
            Array.append(Array.lastNonEmpty(segments), text),
          ),
      }),
  );

const startsWith = (words: ReadonlyArray<string>, prefix: ReadonlyArray<string>): boolean =>
  Array.every(prefix, (word, index) => words[index] === word);

const isFlag = String.startsWith('-');

// Binary: a command. Package: a package that a runner fetches and runs, less its @version.
export type Invoked = Data.TaggedEnum<{
  Binary: { readonly name: string };
  Package: { readonly name: string };
}>;

export const Invoked = Data.taggedEnum<Invoked>();

const VERSION = /(?!^)@.*$/;

const handedOn = (
  runner: Runner,
  words: ReadonlyArray<string>,
  scripts: ReadonlyArray<string>,
): ReadonlyArray<Invoked> => {
  const rest = Array.dropWhile(words.slice(runner.words.length), isFlag);
  return Match.value(runner.hands).pipe(
    Match.when('binary', () => commandWords(scripts)(rest)),
    Match.when('package', () => [
      ...Array.map(Array.take(rest, 1), (spec) =>
        Invoked.Package({ name: String.replace(VERSION, '')(spec) }),
      ),
      ...commandWords(scripts)(rest),
    ]),
    Match.when('script', () =>
      Array.match(rest, {
        onEmpty: (): ReadonlyArray<Invoked> => [],
        onNonEmpty: (next) =>
          Array.contains(scripts, Array.headNonEmpty(next)) ? [] : commandWords(scripts)(next),
      }),
    ),
    Match.when('script-only', (): ReadonlyArray<Invoked> => []),
    Match.when('separated', () =>
      pipe(
        Array.findFirstIndex(words, (word) => word === '--'),
        Option.match({ onNone: () => rest, onSome: (at) => words.slice(at + 1) }),
        commandWords(scripts),
      ),
    ),
    Match.when('nested', () =>
      Array.flatMap(Array.take(rest, 1), (nested) => invokedCommands(nested, scripts)),
    ),
    Match.exhaustive,
  );
};

// A runner is a command too: cross-env or dotenv-cli is the package that provides it.
const commandWords =
  (scripts: ReadonlyArray<string>) =>
  (words: ReadonlyArray<string>): ReadonlyArray<Invoked> =>
    Array.match(
      Array.dropWhile(words, (word) => ENV_ASSIGNMENT.test(word) || Array.contains(KEYWORDS, word)),
      {
        onEmpty: (): ReadonlyArray<Invoked> => [],
        onNonEmpty: (command) => [
          Invoked.Binary({ name: Array.headNonEmpty(command) }),
          ...pipe(
            Array.findFirst(RUNNERS, (runner) => startsWith(command, runner.words)),
            Option.map((runner) => handedOn(runner, command, scripts)),
            Option.getOrElse((): ReadonlyArray<Invoked> => []),
          ),
        ],
      },
    );

export const invokedCommands = (
  script: string,
  scripts: ReadonlyArray<string>,
): ReadonlyArray<Invoked> =>
  pipe(segmentsOf(script), Array.flatMap(commandWords(scripts)), Array.dedupe);

// Husky runs the git hooks in .husky/ at the project root. A hook is named after its git event,
// without an extension; other files there are scripts a hook may call.
export const readHookCommands = (
  rootDir: string,
  scripts: ReadonlyArray<string>,
): Gathered<ScriptCommand> => {
  const hooksDir = path.join(rootDir, '.husky');
  const hooks = gatherOptional(
    Result.map(readDirectory(hooksDir), (entries) =>
      pipe(
        entries,
        Array.filter((entry) => entry.isFile() && path.extname(entry.name) === ''),
        Array.map((entry) => path.join(hooksDir, entry.name)),
      ),
    ),
  );
  return gatherAll([
    { found: [], skipped: hooks.skipped },
    ...Array.map(hooks.found, (file) =>
      gatherOptional(
        Result.map(readFile(file), (script): ReadonlyArray<ScriptCommand> => [
          { file, script, scripts },
        ]),
      ),
    ),
  ]);
};
