import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Array, Option, Result, Schema, pipe } from 'effect';
import { readJsonFile } from './file-reader.js';
import { readTsConfig } from './tsconfig-reader.js';

const PackageScripts = Schema.Struct({
  scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

const OUT_DIR_FLAG = /--outDir\s+(\S+)/;

const outDirsFromScripts = (pkg: typeof PackageScripts.Type): ReadonlyArray<string> =>
  pipe(
    Object.values(pkg.scripts ?? {}),
    Array.map((script) => Option.fromNullishOr(OUT_DIR_FLAG.exec(script)?.[1])),
    Array.getSomes,
    Array.map((dir) => `${dir}/**`),
  );

export const detectBuildDirectories = (projectRoot: string): ReadonlyArray<string> => {
  const fromPkg = pipe(
    readJsonFile(PackageScripts)(join(projectRoot, 'package.json')),
    Result.map(outDirsFromScripts),
    Result.getOrElse((): ReadonlyArray<string> => []),
  );

  const fromTsConfig = pipe(
    readTsConfig(projectRoot),
    Result.map((cfg) =>
      pipe(
        Option.fromNullishOr(cfg.compilerOptions?.outDir),
        Option.map((dir) => `${dir}/**`),
        Option.toArray,
      ),
    ),
    Result.getOrElse((): ReadonlyArray<string> => []),
  );

  return Array.dedupe([...fromPkg, ...fromTsConfig]);
};

const BUILD_LIKE_SUFFIXES = ['-static', '-dist', '-build', '-output'];

const isDirectory = (path: string): boolean =>
  pipe(
    Result.try(() => statSync(path).isDirectory()),
    Result.getOrElse(() => false),
  );

export const detectByHeuristic = (projectRoot: string): ReadonlyArray<string> =>
  pipe(
    Result.try(() => readdirSync(projectRoot)),
    Result.map((entries) =>
      pipe(
        entries,
        Array.filter((entry) => isDirectory(join(projectRoot, entry))),
        Array.filter((dir) => Array.some(BUILD_LIKE_SUFFIXES, (suffix) => dir.endsWith(suffix))),
        Array.map((dir) => `${dir}/**`),
      ),
    ),
    Result.getOrElse((): ReadonlyArray<string> => []),
  );
