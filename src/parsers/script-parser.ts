import path from 'node:path';
import { Array, Data, Match, Option, Result, String, pipe } from 'effect';
import type { Gathered, ScriptCommand } from '../domain/types.js';
import { gatherAll, gatherOptional, readDirectory, readFile } from '../utils/file-reader.js';

// binary: the next word is a binary. script: the next word is a script of the same package.json
// when it names one, else a binary. separated: the command follows `--` when there is one.
type Hands = 'binary' | 'script' | 'separated';

type Runner = { readonly words: ReadonlyArray<string>; readonly hands: Hands };

// Longer prefixes first: `pnpm exec` is not `pnpm` running a script named exec.
const RUNNERS: ReadonlyArray<Runner> = [
  { words: ['npx'], hands: 'binary' },
  { words: ['npm', 'exec'], hands: 'binary' },
  { words: ['pnpm', 'exec'], hands: 'binary' },
  { words: ['pnpm', 'dlx'], hands: 'binary' },
  { words: ['yarn', 'exec'], hands: 'binary' },
  { words: ['yarn', 'dlx'], hands: 'binary' },
  { words: ['bunx'], hands: 'binary' },
  { words: ['bun', 'x'], hands: 'binary' },
  { words: ['cross-env'], hands: 'binary' },
  { words: ['dotenv'], hands: 'separated' },
  { words: ['npm', 'run'], hands: 'script' },
  { words: ['npm', 'run-script'], hands: 'script' },
  { words: ['pnpm', 'run'], hands: 'script' },
  { words: ['yarn', 'run'], hands: 'script' },
  { words: ['bun', 'run'], hands: 'script' },
  { words: ['bun'], hands: 'script' },
  { words: ['pnpm'], hands: 'script' },
  { words: ['yarn'], hands: 'script' },
];

// A comment, a word with its quoted parts, or a separator between commands.
const TOKEN = /#[^\n]*|(?:[^\s'"`;&|()]|'[^']*'|"(?:\\.|[^"\\])*")+|&&|\|\||[;&|()\n]/g;

const SEPARATOR = /^(?:&&|\|\||[;&|()\n])$/;

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

const handedOn = (
  runner: Runner,
  words: ReadonlyArray<string>,
  scripts: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const rest = Array.dropWhile(words.slice(runner.words.length), isFlag);
  return Match.value(runner.hands).pipe(
    Match.when('binary', () => rest),
    Match.when('script', () =>
      Array.match(rest, {
        onEmpty: (): ReadonlyArray<string> => [],
        onNonEmpty: (next) => (Array.contains(scripts, Array.headNonEmpty(next)) ? [] : next),
      }),
    ),
    Match.when('separated', () =>
      pipe(
        Array.findFirstIndex(words, (word) => word === '--'),
        Option.match({ onNone: () => rest, onSome: (at) => words.slice(at + 1) }),
      ),
    ),
    Match.exhaustive,
  );
};

// A runner is a command too: cross-env or dotenv-cli is the package that provides it.
const commandWords =
  (scripts: ReadonlyArray<string>) =>
  (words: ReadonlyArray<string>): ReadonlyArray<string> =>
    Array.match(
      Array.dropWhile(words, (word) => ENV_ASSIGNMENT.test(word) || Array.contains(KEYWORDS, word)),
      {
        onEmpty: (): ReadonlyArray<string> => [],
        onNonEmpty: (command) => [
          Array.headNonEmpty(command),
          ...pipe(
            Array.findFirst(RUNNERS, (runner) => startsWith(command, runner.words)),
            Option.map((runner) => commandWords(scripts)(handedOn(runner, command, scripts))),
            Option.getOrElse((): ReadonlyArray<string> => []),
          ),
        ],
      },
    );

export const invokedCommands = (
  script: string,
  scripts: ReadonlyArray<string>,
): ReadonlyArray<string> =>
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
