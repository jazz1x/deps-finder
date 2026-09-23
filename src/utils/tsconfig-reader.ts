import path from 'node:path';
import { Array, Option, Result, Schema, String, pipe } from 'effect';
import type { Gathered } from '../domain/types.js';
import { gatherAll, gatherOptional, readJsoncFile } from './file-reader.js';

const TsConfig = Schema.Struct({
  compilerOptions: Schema.optionalKey(
    Schema.Struct({
      outDir: Schema.optionalKey(Schema.NonEmptyString),
      baseUrl: Schema.optionalKey(Schema.String),
      paths: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.String))),
    }),
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

// A wildcard target reaches everything under its fixed prefix; an exact one, its own path.
const reachedPrefix = (target: string): string =>
  Option.match(String.indexOf('*')(target), {
    onNone: () => `${target}/`,
    onSome: (star) => target.slice(0, star),
  });

export const aliasTargetsOf = (configs: ReadonlyArray<TsConfig>): ReadonlyArray<string> =>
  Array.flatMap(configs, (config) =>
    pipe(
      Object.values(config.compilerOptions?.paths ?? {}),
      Array.flatten,
      Array.map((target) =>
        reachedPrefix(path.posix.join(config.compilerOptions?.baseUrl ?? '.', target)),
      ),
    ),
  );
