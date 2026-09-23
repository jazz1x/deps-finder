import { readFileSync } from 'node:fs';
import { Match, Result, Schema, pipe } from 'effect';
import { FileError } from '../domain/errors.js';

const readFailure = (path: string) => (cause: unknown) =>
  Match.value(cause).pipe(
    Match.when({ code: 'ENOENT' }, () => FileError.FileNotFound({ path })),
    Match.orElse(() => FileError.ReadFailed({ path, reason: String(cause) })),
  );

export const readFile = (path: string): Result.Result<string, FileError> =>
  Result.try({ try: () => readFileSync(path, 'utf-8'), catch: readFailure(path) });

export const readJsonFile =
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  (path: string): Result.Result<S['Type'], FileError> =>
    pipe(
      readFile(path),
      Result.flatMap((text) =>
        pipe(
          Schema.decodeUnknownResult(Schema.fromJsonString(schema))(text),
          Result.mapError((error) => FileError.ParseFailed({ path, reason: error.message })),
        ),
      ),
    );
