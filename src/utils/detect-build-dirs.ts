import { join } from 'node:path';
import { Array, Option, Result, Schema, pipe } from 'effect';
import type { Gathered } from '../domain/types.js';
import { gatherAll, gatherOptional, readDirectory, readJsonFile } from './file-reader.js';
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
  );

export const detectBuildDirectories = (projectRoot: string): Gathered<string> =>
  gatherAll([
    gatherOptional(
      Result.map(
        readJsonFile(PackageScripts)(join(projectRoot, 'package.json')),
        outDirsFromScripts,
      ),
    ),
    gatherOptional(
      Result.map(readTsConfig(projectRoot), (cfg) =>
        Option.toArray(Option.fromNullishOr(cfg.compilerOptions?.outDir)),
      ),
    ),
  ]);

const BUILD_LIKE_SUFFIXES = ['-static', '-dist', '-build', '-output'];

export const detectByHeuristic = (projectRoot: string): Gathered<string> =>
  gatherOptional(
    Result.map(readDirectory(projectRoot), (entries) =>
      pipe(
        entries,
        Array.filter((entry) => entry.isDirectory()),
        Array.map((entry) => entry.name),
        Array.filter((dir) => Array.some(BUILD_LIKE_SUFFIXES, (suffix) => dir.endsWith(suffix))),
      ),
    ),
  );
