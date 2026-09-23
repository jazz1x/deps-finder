import { join } from 'node:path';
import { type Result, Schema } from 'effect';
import type { FileError } from '../domain/errors.js';
import { readJsonFile } from './file-reader.js';

const TsConfig = Schema.Struct({
  compilerOptions: Schema.optionalKey(Schema.Struct({ outDir: Schema.optionalKey(Schema.String) })),
});

export type TsConfig = typeof TsConfig.Type;

export const readTsConfig = (projectRoot: string): Result.Result<TsConfig, FileError> =>
  readJsonFile(TsConfig)(join(projectRoot, 'tsconfig.json'));
