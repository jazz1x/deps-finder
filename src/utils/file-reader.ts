import {
  type Dirent,
  type Stats,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { Array, Effect, Match, Option, Result, Schema, pipe } from 'effect';
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

const BYTE_ORDER_MARKS = [
  { mark: [0xff, 0xfe], encoding: 'utf-16le' },
  { mark: [0xfe, 0xff], encoding: 'utf-16be' },
] as const;

// As tsc reads a source. TextDecoder drops the byte order mark it decodes by, UTF-8's included.
const decode = (bytes: Uint8Array): string =>
  new TextDecoder(
    pipe(
      Array.findFirst(BYTE_ORDER_MARKS, ({ mark }) =>
        Array.every(mark, (byte, index) => bytes[index] === byte),
      ),
      Option.match({ onNone: () => 'utf-8', onSome: ({ encoding }) => encoding }),
    ),
  ).decode(bytes);

export const readFile = (path: string): Result.Result<string, FileError> =>
  Result.try({ try: () => decode(readFileSync(path)), catch: readFailure(path) });

export const readStats = (path: string): Result.Result<Stats, FileError> =>
  Result.try({ try: () => statSync(path), catch: readFailure(path) });

// A path that cannot be stat'ed holds no file to resolve to.
export const isFile = (file: string): boolean =>
  Result.match(readStats(file), { onSuccess: (stats) => stats.isFile(), onFailure: () => false });

export const isDirectory = (dir: string): boolean =>
  Result.match(readStats(dir), {
    onSuccess: (stats) => stats.isDirectory(),
    onFailure: () => false,
  });

export const readRealPath = (path: string): Result.Result<string, FileError> =>
  Result.try({ try: () => realpathSync(path), catch: readFailure(path) });

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
const yamlDocument = (text: string): Result.Result<YAML.Document.Parsed, string> => {
  const document = YAML.parseDocument(text, { prettyErrors: false, logLevel: 'error' });
  return pipe(
    Array.head(document.errors),
    Option.match({
      onNone: () => Result.succeed(document),
      onSome: (problem) => Result.fail(problem.message),
    }),
  );
};

const yaml: TextParser = (text) =>
  Result.flatMap(yamlDocument(text), (document) =>
    Result.try({ try: (): unknown => document.toJS(), catch: messageOf }),
  );

// The document before toJS, whose alias limit guards against expanding aliases.
export const decodeYamlDocument =
  (path: string) =>
  (text: string): Result.Result<YAML.Document.Parsed, FileError> =>
    Result.mapError(yamlDocument(text), (reason) => FileError.ParseFailed({ path, reason }));

const decodeStructured =
  (parse: TextParser) =>
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  (path: string) =>
  (text: string): Result.Result<S['Type'], FileError> =>
    pipe(
      Result.mapError(parse(text), (reason) => FileError.ParseFailed({ path, reason })),
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

// A field whose value fits no schema is dropped and leaves the rest of the file usable.
export const lenientKey = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(schema.pipe(Schema.catchDecoding(() => Effect.succeedNone)));

export const readJsonFile = readStructured(strictJson);

export const decodeJsonc = decodeStructured(jsonWithComments);

export const readJsoncFile = readStructured(jsonWithComments);

export const readYamlFile = readStructured(yaml);
