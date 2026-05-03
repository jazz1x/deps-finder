import { readFileSync } from 'node:fs';
import { R, pipe } from '@mobily/ts-belt';
import type { FileError } from '../domain/errors.js';

/**
 * 동기로 파일 읽기
 */
export const readFile = (path: string): R.Result<string, FileError> => {
  return pipe(
    R.fromExecution(() => readFileSync(path, 'utf-8')),
    R.mapError((error) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { type: 'FILE_NOT_FOUND', path } as const;
      }
      return { type: 'READ_ERROR', path, error: error as Error } as const;
    }),
  );
};

/**
 * 동기로 JSON 파일 읽기
 */
export const readJSONFile = <T>(path: string): R.Result<T, FileError> => {
  return pipe(
    readFile(path),
    R.flatMap((content) =>
      pipe(
        R.fromExecution(() => JSON.parse(content) as T),
        R.mapError((error) => ({ type: 'PARSE_ERROR', path, error: error as Error }) as const),
      ),
    ),
  );
};
