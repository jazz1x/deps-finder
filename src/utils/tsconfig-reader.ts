import path from 'node:path';
import { Array, Match, Option, Order, Result, Schema, String, pipe } from 'effect';
import { TSCONFIG_FILE_PATTERN } from '../constants/patterns.js';
import { FileError } from '../domain/errors.js';
import type { Gathered } from '../domain/types.js';
import {
  decodeJsonc,
  gatherOptional,
  isFile,
  lenientKey,
  readDirectory,
  readFile,
} from './file-reader.js';
import { lineage } from './project-walk.js';

// tsc accepts null: it clears an inherited option.
const TsConfig = Schema.Struct({
  extends: lenientKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  references: lenientKey(Schema.Array(Schema.Struct({ path: Schema.String }))),
  files: lenientKey(Schema.NullOr(Schema.Array(Schema.String))),
  include: lenientKey(Schema.NullOr(Schema.Array(Schema.String))),
  exclude: lenientKey(Schema.NullOr(Schema.Array(Schema.String))),
  compilerOptions: Schema.optionalKey(
    Schema.Struct({
      outDir: lenientKey(Schema.NonEmptyString),
      declarationDir: lenientKey(Schema.NonEmptyString),
      baseUrl: lenientKey(Schema.NullOr(Schema.String)),
      paths: lenientKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Array(Schema.String)))),
      types: lenientKey(Schema.NullOr(Schema.Array(Schema.String))),
      plugins: lenientKey(Schema.NullOr(Schema.Array(Schema.Struct({ name: Schema.String })))),
      importHelpers: lenientKey(Schema.NullOr(Schema.Boolean)),
      jsx: lenientKey(
        Schema.NullOr(
          Schema.Literals(['preserve', 'react', 'react-jsx', 'react-jsxdev', 'react-native']),
        ),
      ),
      jsxImportSource: lenientKey(Schema.NullOr(Schema.NonEmptyString)),
      jsxFactory: lenientKey(Schema.NullOr(Schema.NonEmptyString)),
      emitDecoratorMetadata: lenientKey(Schema.NullOr(Schema.Boolean)),
      verbatimModuleSyntax: lenientKey(Schema.NullOr(Schema.Boolean)),
      preserveValueImports: lenientKey(Schema.NullOr(Schema.Boolean)),
      importsNotUsedAsValues: lenientKey(
        Schema.NullOr(Schema.Literals(['remove', 'preserve', 'error'])),
      ),
    }),
  ),
});

export type TsConfig = typeof TsConfig.Type;

export type TsConfigFile = {
  readonly path: string;
  readonly text: string;
  readonly config: TsConfig;
};

const readTsConfigFile = (file: string): Result.Result<TsConfigFile, FileError> =>
  Result.flatMap(readFile(file), (text) =>
    Result.map(decodeJsonc(TsConfig)(file)(text), (config) => ({ path: file, text, config })),
  );

export const extendsOf = (config: TsConfig): ReadonlyArray<string> =>
  Match.value(config.extends).pipe(
    Match.when(Match.undefined, (): ReadonlyArray<string> => []),
    Match.when(Match.string, (single) => [single]),
    Match.orElse((several) => several),
  );

const withJsonSuffix = (base: string): ReadonlyArray<string> =>
  base.endsWith('.json') ? [base] : [base, `${base}.json`];

const isPathSpecifier = (specifier: string): boolean =>
  specifier.startsWith('.') || path.isAbsolute(specifier);

type Target = { readonly expected: string; readonly candidates: ReadonlyArray<string> };

// A package specifier resolves through node_modules in the extending file's directory and above.
const extendedBy = (from: string, specifier: string): Target =>
  Match.value(specifier).pipe(
    Match.when(isPathSpecifier, (relative): Target => {
      const base = path.resolve(path.dirname(from), relative);
      return { expected: base, candidates: withJsonSuffix(base) };
    }),
    Match.orElse((pkg): Target => ({
      expected: path.join(path.dirname(from), 'node_modules', pkg),
      candidates: Array.flatMap(lineage(path.dirname(from)), (dir) => {
        const base = path.join(dir, 'node_modules', pkg);
        return [...withJsonSuffix(base), path.join(base, 'tsconfig.json')];
      }),
    })),
  );

const referencedBy = (from: string, reference: string): Target => {
  const base = path.resolve(path.dirname(from), reference);
  return { expected: base, candidates: [base, path.join(base, 'tsconfig.json')] };
};

const located = (target: Target): Result.Result<string, FileError> =>
  pipe(
    Array.findFirst(target.candidates, isFile),
    Option.match({
      onNone: () => Result.fail(FileError.FileNotFound({ path: target.expected })),
      onSome: Result.succeed,
    }),
  );

// parents: the extends entries from last to first, as TypeScript overrides.
type Linked = {
  readonly file: TsConfigFile;
  readonly parents: ReadonlyArray<string>;
  readonly references: ReadonlyArray<string>;
};

type Loaded = {
  readonly read: ReadonlyMap<string, Option.Option<Linked>>;
  readonly skipped: ReadonlyArray<FileError>;
};

const linkedFrom = (
  file: TsConfigFile,
): { readonly linked: Linked; readonly skipped: ReadonlyArray<FileError> } => {
  const [missingParents, parents] = Array.partition(
    Array.map(Array.reverse(extendsOf(file.config)), (specifier) =>
      extendedBy(file.path, specifier),
    ),
    located,
  );
  const [missingReferences, references] = Array.partition(
    Array.map(file.config.references ?? [], (reference) => referencedBy(file.path, reference.path)),
    located,
  );
  return {
    linked: { file, parents, references },
    skipped: [...missingParents, ...missingReferences],
  };
};

const readInto = (
  loaded: Loaded,
  next: string,
): Loaded & { readonly next: ReadonlyArray<string> } =>
  Result.match(readTsConfigFile(next), {
    onFailure: (error) => ({
      read: new Map([...loaded.read, [next, Option.none()]]),
      skipped: [...loaded.skipped, error],
      next: [],
    }),
    onSuccess: (file) => {
      const { linked, skipped } = linkedFrom(file);
      return {
        read: new Map([...loaded.read, [next, Option.some(linked)]]),
        skipped: [...loaded.skipped, ...skipped],
        next: [...linked.parents, ...linked.references],
      };
    },
  });

// Every file is read once, however many configs extend or reference it.
const load = (pending: ReadonlyArray<string>, loaded: Loaded): Loaded =>
  Array.match(pending, {
    onEmpty: () => loaded,
    onNonEmpty: ([next, ...rest]) =>
      loaded.read.has(next)
        ? load(rest, loaded)
        : pipe(readInto(loaded, next), (after) => load([...rest, ...after.next], after)),
  });

const linkedAt = (loaded: Loaded, file: string): Option.Option<Linked> =>
  Option.flatten(Option.fromUndefinedOr(loaded.read.get(file)));

const chainAt = (
  loaded: Loaded,
  file: string,
  seen: ReadonlyArray<string>,
): ReadonlyArray<TsConfigFile> =>
  Option.match(linkedAt(loaded, file), {
    onNone: () => [],
    onSome: (linked) => [
      linked.file,
      ...pipe(
        linked.parents,
        Array.filter((parent) => !Array.contains(seen, parent)),
        Array.flatMap((parent) => chainAt(loaded, parent, [...seen, parent])),
      ),
    ],
  });

const withReferences = (
  loaded: Loaded,
  pending: ReadonlyArray<string>,
  heads: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  Array.match(pending, {
    onEmpty: () => heads,
    onNonEmpty: ([next, ...rest]) =>
      Array.contains(heads, next)
        ? withReferences(loaded, rest, heads)
        : withReferences(
            loaded,
            [
              ...rest,
              ...Option.match(linkedAt(loaded, next), {
                onNone: () => [],
                onSome: (linked) => linked.references,
              }),
            ],
            [...heads, next],
          ),
  });

export type TsConfigChain = Array.NonEmptyReadonlyArray<TsConfigFile>;

// Nearest first. roots: tsconfig files that govern a directory; the projects they reference do too.
export const readTsConfigChains = (roots: ReadonlyArray<string>): Gathered<TsConfigChain> => {
  const loaded = load(roots, { read: new Map(), skipped: [] });
  const chains = pipe(
    withReferences(loaded, roots, []),
    Array.map((head) => chainAt(loaded, head, [head])),
    Array.filter(Array.isReadonlyArrayNonEmpty),
  );
  const inherits = (other: TsConfigChain, chain: TsConfigChain): boolean =>
    Array.some(Array.tailNonEmpty(other), (file) => file.path === Array.headNonEmpty(chain).path);
  // A root that another root extends is read through that root; of an extends cycle, the first.
  const readThroughAnother = (chain: TsConfigChain, index: number): boolean =>
    Array.some(
      chains,
      (other, at) => inherits(other, chain) && (at < index || !inherits(chain, other)),
    );
  return {
    found: Array.filter(chains, (chain, index) => !readThroughAnother(chain, index)),
    skipped: Array.dedupe(loaded.skipped),
  };
};

// Build-directory detection reads these before the walk finds the governing tsconfig files, so
// findFiles dedupes their errors.
export const readRootTsConfigs = (projectRoot: string): Gathered<TsConfigChain> => {
  const roots = gatherOptional(
    Result.map(readDirectory(projectRoot), (entries) =>
      pipe(
        entries,
        Array.filter((entry) => !entry.isDirectory() && TSCONFIG_FILE_PATTERN.test(entry.name)),
        Array.map((entry) => path.resolve(projectRoot, entry.name)),
        (files) => Array.sort(files, Order.String),
      ),
    ),
  );
  const chains = readTsConfigChains(roots.found);
  return { found: chains.found, skipped: [...roots.skipped, ...chains.skipped] };
};

const OUTPUT_OPTIONS = ['outDir', 'declarationDir'] as const;

// A relative option resolves from the file that declares it; ${configDir} is the extending file's.
export const outDirsOf = (chain: TsConfigChain): ReadonlyArray<string> =>
  Array.getSomes(
    Array.map(OUTPUT_OPTIONS, (option) =>
      Array.findFirst(chain, (file) =>
        Option.map(Option.fromNullishOr(file.config.compilerOptions?.[option]), (dir) =>
          path.resolve(
            path.dirname(file.path),
            pipe(
              dir,
              String.replaceAll('${configDir}', path.dirname(Array.headNonEmpty(chain).path)),
              String.replaceAll('\\', '/'),
            ),
          ),
        ),
      ),
    ),
  );
