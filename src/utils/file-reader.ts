import { type Dirent, type Stats, readFileSync, readdirSync, statSync } from 'node:fs';
import { Array, Match, Option, Result, Schema, pipe } from 'effect';
import jsonc from 'jsonc-parser';
import YAML from 'yaml';
import { FileError } from '../domain/errors.js';
import type { Gathered } from '../domain/types.js';

const messageOf = (cause: unknown): string =>
  Match.value(cause).pipe(
    Match.when(Match.instanceOf(Error), (error) => error.message),
    Match.orElse(String),
  );

const readFailure = (path: string) => (cause: unknown) =>
  Match.value(cause).pipe(
    Match.when({ code: Match.is('ENOENT', 'ENOTDIR') }, () => FileError.FileNotFound({ path })),
    Match.orElse(() => FileError.ReadFailed({ path, reason: messageOf(cause) })),
  );

export const readFile = (path: string): Result.Result<string, FileError> =>
  Result.try({ try: () => readFileSync(path, 'utf-8'), catch: readFailure(path) });

export const readStats = (path: string): Result.Result<Stats, FileError> =>
  Result.try({ try: () => statSync(path), catch: readFailure(path) });

export const readDirectory = (path: string): Result.Result<ReadonlyArray<Dirent>, FileError> =>
  Result.try({ try: () => readdirSync(path, { withFileTypes: true }), catch: readFailure(path) });

export const gatherAll = <A>(parts: ReadonlyArray<Gathered<A>>): Gathered<A> => ({
  found: Array.flatMap(parts, (part) => part.found),
  skipped: Array.flatMap(parts, (part) => part.skipped),
});

const skippedUnlessAbsent = FileError.$match({
  FileNotFound: (): ReadonlyArray<FileError> => [],
  ReadFailed: (error): ReadonlyArray<FileError> => [error],
  ParseFailed: (error): ReadonlyArray<FileError> => [error],
});

export const gatherOptional = <A>(
  result: Result.Result<ReadonlyArray<A>, FileError>,
): Gathered<A> =>
  Result.match(result, {
    onSuccess: (found) => ({ found, skipped: [] }),
    onFailure: (error) => ({ found: [], skipped: skippedUnlessAbsent(error) }),
  });

type TextParser = (text: string) => Result.Result<unknown, string>;

const strictJson: TextParser = (text) =>
  Result.try({ try: (): unknown => JSON.parse(text), catch: messageOf });

const jsonWithComments: TextParser = (text) => {
  const errors: jsonc.ParseError[] = [];
  const value: unknown = jsonc.parse(text, errors, { allowTrailingComma: true });
  return pipe(
    Array.head(errors),
    Option.match({
      onNone: () => Result.succeed(value),
      onSome: (error) =>
        Result.fail(`${jsonc.printParseErrorCode(error.error)} at offset ${error.offset}`),
    }),
  );
};

// yaml sends warnings to process.emitWarning (at parse time and from toJS) unless logLevel is
// 'error'. A warning still leaves a usable value, as pnpm's reader does.
const yaml: TextParser = (text) => {
  const document = YAML.parseDocument(text, { prettyErrors: false, logLevel: 'error' });
  return pipe(
    Array.head(document.errors),
    Option.match({
      onNone: () => Result.try({ try: (): unknown => document.toJS(), catch: messageOf }),
      onSome: (problem) => Result.fail(problem.message),
    }),
  );
};

const stripByteOrderMark = (text: string): string =>
  text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

const decodeStructured =
  (parse: TextParser) =>
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  (path: string) =>
  (text: string): Result.Result<S['Type'], FileError> =>
    pipe(
      Result.mapError(parse(stripByteOrderMark(text)), (reason) =>
        FileError.ParseFailed({ path, reason }),
      ),
      Result.flatMap((json) =>
        pipe(
          Schema.decodeUnknownResult(schema)(json),
          Result.mapError((error) => FileError.ParseFailed({ path, reason: error.message })),
        ),
      ),
    );

const readStructured =
  (parse: TextParser) =>
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  (path: string): Result.Result<S['Type'], FileError> =>
    Result.flatMap(readFile(path), decodeStructured(parse)(schema)(path));

export const readJsonFile = readStructured(strictJson);

export const decodeJsonc = decodeStructured(jsonWithComments);

export const readJsoncFile = readStructured(jsonWithComments);

export const readYamlFile = readStructured(yaml);
