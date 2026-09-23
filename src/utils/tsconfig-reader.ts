import path from 'node:path';
import { Array, Option, Result, Schema } from 'effect';
import type { Gathered } from '../domain/types.js';
import { gatherAll, gatherOptional, readJsoncFile } from './file-reader.js';

const TsConfig = Schema.Struct({
  compilerOptions: Schema.optionalKey(
    Schema.Struct({ outDir: Schema.optionalKey(Schema.NonEmptyString) }),
  ),
});

export type TsConfig = typeof TsConfig.Type;

const ROOT_TSCONFIGS = ['tsconfig.json', 'tsconfig.base.json'];

export const readRootTsConfigs = (projectRoot: string): Gathered<TsConfig> =>
  gatherAll(
    Array.map(ROOT_TSCONFIGS, (name) =>
      gatherOptional(Result.map(readJsoncFile(TsConfig)(path.join(projectRoot, name)), Array.of)),
    ),
  );

export const outDirsOf = (configs: ReadonlyArray<TsConfig>): ReadonlyArray<string> =>
  Array.flatMap(configs, (config) =>
    Option.toArray(Option.fromNullishOr(config.compilerOptions?.outDir)),
  );
