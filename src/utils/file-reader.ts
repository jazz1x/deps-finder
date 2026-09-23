import { readFileSync } from 'node:fs';
import { Array, Match, Option, Result, Schema, pipe } from 'effect';
import jsonc from 'jsonc-parser';
import { FileError } from '../domain/errors.js';

const messageOf = (cause: unknown): string =>
  Match.value(cause).pipe(
    Match.when(Match.instanceOf(Error), (error) => error.message),
    Match.orElse(String),
  );

const readFailure = (path: string) => (cause: unknown) =>
  Match.value(cause).pipe(
    Match.when({ code: 'ENOENT' }, () => FileError.FileNotFound({ path })),
    Match.orElse(() => FileError.ReadFailed({ path, reason: messageOf(cause) })),
  );

export const readFile = (path: string): Result.Result<string, FileError> =>
  Result.try({ try: () => readFileSync(path, 'utf-8'), catch: readFailure(path) });

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

const readStructured =
  (parse: TextParser) =>
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  (path: string): Result.Result<S['Type'], FileError> =>
    pipe(
      readFile(path),
      Result.map((text) => text.replace(/^﻿/, '')),
      Result.flatMap((text) =>
        Result.mapError(parse(text), (reason) => FileError.ParseFailed({ path, reason })),
      ),
      Result.flatMap((json) =>
        pipe(
          Schema.decodeUnknownResult(schema)(json),
          Result.mapError((error) => FileError.ParseFailed({ path, reason: error.message })),
        ),
      ),
    );

export const readJsonFile = readStructured(strictJson);

export const readJsoncFile = readStructured(jsonWithComments);
