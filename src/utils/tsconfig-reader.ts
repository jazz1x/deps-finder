import { join } from 'node:path';
import { type Result, Schema } from 'effect';
import type { FileError } from '../domain/errors.js';
import { readJsoncFile } from './file-reader.js';

const TsConfig = Schema.Struct({
  compilerOptions: Schema.optionalKey(
    Schema.Struct({ outDir: Schema.optionalKey(Schema.NonEmptyString) }),
  ),
});

export type TsConfig = typeof TsConfig.Type;

export const readTsConfig = (projectRoot: string): Result.Result<TsConfig, FileError> =>
  readJsoncFile(TsConfig)(join(projectRoot, 'tsconfig.json'));
