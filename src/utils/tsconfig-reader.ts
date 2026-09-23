import path from 'node:path';
import { Array, Effect, Match, Option, Result, Schema, pipe } from 'effect';
import { FileError } from '../domain/errors.js';
import type { Gathered } from '../domain/types.js';
import { decodeJsonc, gatherAll, gatherOptional, readFile, readStats } from './file-reader.js';
import { lineage } from './project-walk.js';

// tsc accepts null (it clears an inherited option); a value that fits no field leaves the rest usable.
const option = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(schema.pipe(Schema.catchDecoding(() => Effect.succeedNone)));

const TsConfig = Schema.Struct({
  extends: option(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  compilerOptions: Schema.optionalKey(
    Schema.Struct({
      outDir: option(Schema.NonEmptyString),
      declarationDir: option(Schema.NonEmptyString),
      types: option(Schema.NullOr(Schema.Array(Schema.String))),
      importHelpers: option(Schema.NullOr(Schema.Boolean)),
    }),
  ),
});

export type TsConfig = typeof TsConfig.Type;

export type TsConfigFile = {
  readonly path: string;
  readonly text: string;
  readonly config: TsConfig;
};

const ROOT_TSCONFIGS = ['tsconfig.json', 'tsconfig.base.json'];

const readTsConfigFile = (file: string): Result.Result<TsConfigFile, FileError> =>
  Result.flatMap(readFile(file), (text) =>
    Result.map(decodeJsonc(TsConfig)(file)(text), (config) => ({ path: file, text, config })),
  );

// The build-directory detection and the usage reader each read these; equal paths let their
// errors dedupe.
const readRootFiles = (projectRoot: string): Gathered<TsConfigFile> =>
  gatherAll(
    Array.map(ROOT_TSCONFIGS, (name) =>
      gatherOptional(Result.map(readTsConfigFile(path.resolve(projectRoot, name)), Array.of)),
    ),
  );

export const readRootTsConfigs = (projectRoot: string): Gathered<TsConfig> => {
  const roots = readRootFiles(projectRoot);
  return { found: Array.map(roots.found, (file) => file.config), skipped: roots.skipped };
};

export const outDirsOf = (configs: ReadonlyArray<TsConfig>): ReadonlyArray<string> =>
  Array.flatMap(configs, (config) =>
    Array.getSomes([
      Option.fromNullishOr(config.compilerOptions?.outDir),
      Option.fromNullishOr(config.compilerOptions?.declarationDir),
    ]),
  );

export const extendsOf = (config: TsConfig): ReadonlyArray<string> =>
  Match.value(config.extends).pipe(
    Match.when(Match.undefined, (): ReadonlyArray<string> => []),
    Match.when(Match.string, (single) => [single]),
    Match.orElse((several) => several),
  );

const isFile = (file: string): boolean =>
  Result.match(readStats(file), { onSuccess: (stats) => stats.isFile(), onFailure: () => false });

const withJsonSuffix = (base: string): ReadonlyArray<string> =>
  base.endsWith('.json') ? [base] : [base, `${base}.json`];

const isPathSpecifier = (specifier: string): boolean =>
  specifier.startsWith('.') || path.isAbsolute(specifier);

type Extended = { readonly expected: string; readonly candidates: ReadonlyArray<string> };

// A package specifier resolves through node_modules in the extending file's directory and above.
const extendedBy = (from: string, specifier: string): Extended =>
  Match.value(specifier).pipe(
    Match.when(isPathSpecifier, (relative): Extended => {
      const base = path.resolve(path.dirname(from), relative);
      return { expected: base, candidates: withJsonSuffix(base) };
    }),
    Match.orElse((pkg): Extended => ({
      expected: path.join(path.dirname(from), 'node_modules', pkg),
      candidates: Array.flatMap(lineage(path.dirname(from)), (dir) => {
        const base = path.join(dir, 'node_modules', pkg);
        return [...withJsonSuffix(base), path.join(base, 'tsconfig.json')];
      }),
    })),
  );

export type TsConfigChain = Array.NonEmptyReadonlyArray<TsConfigFile>;

type Chained = { readonly chain: TsConfigChain; readonly skipped: ReadonlyArray<FileError> };

// Nearest first: the file, then its extends entries from last to first, as TypeScript overrides.
const chainFrom = (file: TsConfigFile, seen: ReadonlyArray<string>): Chained => {
  const parents = gatherAll(
    Array.map(Array.reverse(extendsOf(file.config)), (specifier) =>
      parentChain(extendedBy(file.path, specifier), [...seen, file.path]),
    ),
  );
  return { chain: [file, ...parents.found], skipped: parents.skipped };
};

const readParent = (parent: string, seen: ReadonlyArray<string>): Gathered<TsConfigFile> =>
  Result.match(readTsConfigFile(parent), {
    onSuccess: (file) => {
      const { chain, skipped } = chainFrom(file, seen);
      return { found: chain, skipped };
    },
    onFailure: (error) => ({ found: [], skipped: [error] }),
  });

const parentChain = (extended: Extended, seen: ReadonlyArray<string>): Gathered<TsConfigFile> =>
  pipe(
    Array.findFirst(extended.candidates, isFile),
    Option.match({
      onNone: (): Gathered<TsConfigFile> => ({
        found: [],
        skipped: [FileError.FileNotFound({ path: extended.expected })],
      }),
      onSome: (parent) =>
        Array.contains(seen, parent) ? { found: [], skipped: [] } : readParent(parent, seen),
    }),
  );

export const readTsConfigChains = (projectRoot: string): Gathered<TsConfigChain> => {
  const roots = readRootFiles(projectRoot);
  const chained = Array.map(roots.found, (root) => chainFrom(root, []));
  const isIn = (chain: TsConfigChain) => (other: TsConfigChain) =>
    Array.some(other, (file) => file.path === Array.headNonEmpty(chain).path);
  return {
    // A root that an earlier root extends is read through that root.
    found: Array.reduce(
      Array.map(chained, ({ chain }) => chain),
      [] as ReadonlyArray<TsConfigChain>,
      (kept, chain) => (Array.some(kept, isIn(chain)) ? kept : [...kept, chain]),
    ),
    // tsconfig.json and tsconfig.base.json often share parents.
    skipped: Array.dedupe([...roots.skipped, ...Array.flatMap(chained, ({ skipped }) => skipped)]),
  };
};
