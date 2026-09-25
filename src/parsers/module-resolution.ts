import path from 'node:path';
import { Array, Match, Option, Order, Record, Result, String, pipe } from 'effect';
import { DECLARATION_FILE_PATTERN } from '../constants/patterns.js';
import type { FileError } from '../domain/errors.js';
import {
  type BaseUrl,
  type CompilerResolution,
  type Gathered,
  type ModuleResolution,
  type NodeModules,
  type PackageName,
  PathTarget,
  type SubpathImport,
} from '../domain/types.js';
import {
  gatherOptional,
  isDirectory,
  isFile,
  readDirectory,
  readRealPath,
} from '../utils/file-reader.js';
import { lineage } from '../utils/project-walk.js';
import type { TsConfigChain } from '../utils/tsconfig-reader.js';
import { compiledBy, setWhere } from './emit-settings.js';
import type { LayoutManifest } from './package-parser.js';

// A bundler's ?raw or #fragment suffix is not part of the name; a leading # is a subpath import.
const PACKAGE_NAME = /^(?![./]|https?:|file:)(@[^/?#]+\/[^/?#]+|[^@/?#][^/?#]*)/;

export const extractPackageName = (specifier: string): Option.Option<string> =>
  Option.fromNullishOr(PACKAGE_NAME.exec(specifier)?.[1]);

const QUERY_OR_FRAGMENT = /[?#].*$/s;

export const NO_RESOLUTION: ModuleResolution = {
  subpathImports: [],
  compilers: [],
  sources: new Set(),
  nodeModules: [],
};

type PatternMatch<A> = {
  readonly entry: A;
  readonly captured: string;
  readonly prefixLength: number;
};

// An exact key wins, then the "*" pattern with the longest prefix, as Node and tsc pick.
const byPrecedence = <A extends { readonly key: string }>() =>
  Order.combine(
    Order.mapInput(Order.Number, (match: PatternMatch<A>) => match.prefixLength),
    Order.mapInput(Order.Number, (match: PatternMatch<A>) => match.entry.key.length),
  );

// Runs for every key on every import, so it splits the key without building a matcher.
const patternMatchOf =
  (specifier: string) =>
  <A extends { readonly key: string }>(entry: A): Option.Option<PatternMatch<A>> =>
    Array.match(Array.tailNonEmpty(String.split(entry.key, '*')), {
      onEmpty: () =>
        Option.liftPredicate(
          { entry, captured: '', prefixLength: Number.POSITIVE_INFINITY },
          () => entry.key === specifier,
        ),
      onNonEmpty: ([suffix, ...more]) => {
        const prefixLength = entry.key.length - suffix.length - 1;
        return Option.liftPredicate(
          {
            entry,
            captured: specifier.slice(prefixLength, specifier.length - suffix.length),
            prefixLength,
          },
          () =>
            Array.isReadonlyArrayEmpty(more) &&
            specifier.startsWith(entry.key.slice(0, prefixLength)) &&
            specifier.endsWith(suffix) &&
            specifier.length >= entry.key.length,
        );
      },
    });

const bestMatch = <A extends { readonly key: string }>(
  entries: ReadonlyArray<A>,
  specifier: string,
): Option.Option<PatternMatch<A>> =>
  pipe(
    Array.getSomes(Array.map(entries, patternMatchOf(specifier))),
    Array.match({
      onEmpty: () => Option.none(),
      onNonEmpty: (matches) => Option.some(Array.max(matches, byPrecedence<A>())),
    }),
  );

const filled = (template: string, captured: string): string =>
  String.replaceAll('*', captured)(template);

const subpathPackages = (
  subpathImports: ReadonlyArray<SubpathImport>,
  specifier: string,
): ReadonlyArray<PackageName> =>
  Option.match(bestMatch(subpathImports, specifier), {
    onNone: (): ReadonlyArray<PackageName> => [],
    onSome: ({ entry, captured }) =>
      Array.flatMap(entry.targets, (target) =>
        Option.toArray(extractPackageName(filled(target, captured))),
      ),
  });

const RESOLVED_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.d.ts',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
];

// In tsc's order, built one at a time so a lookup stops at the first hit.
const CANDIDATES: ReadonlyArray<(base: string) => string> = [
  (base) => base,
  ...Array.map(RESOLVED_EXTENSIONS, (extension) => (base: string) => `${base}${extension}`),
  ...Array.map(
    RESOLVED_EXTENSIONS,
    (extension) => (base: string) => `${base}${path.sep}index${extension}`,
  ),
];

// tsc reads an import written with its output extension as the source that emits it.
const SOURCE_EXTENSIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  '.js': ['.ts', '.tsx', '.d.ts'],
  '.jsx': ['.tsx', '.ts', '.d.ts'],
  '.mjs': ['.mts', '.d.mts'],
  '.cjs': ['.cts', '.d.cts'],
};

const sourceCandidates = (base: string): ReadonlyArray<string> =>
  pipe(
    Record.get(SOURCE_EXTENSIONS, path.extname(base)),
    Option.map(
      Array.map((extension) => `${base.slice(0, -path.extname(base).length)}${extension}`),
    ),
    Option.getOrElse((): ReadonlyArray<string> => []),
  );

const firstOf = (base: string, exists: (file: string) => boolean): Option.Option<string> =>
  pipe(
    Array.findFirst(CANDIDATES, (candidate) => Option.liftPredicate(candidate(base), exists)),
    Option.orElse(() => Array.findFirst(sourceCandidates(base), exists)),
  );

// The walked sources answer most lookups without touching the disk: on macaron-front's 9,146
// `~/` imports, stat'ing every candidate cost 137ms. Every candidate sits in the base's directory
// or below it, so one stat of that directory spares the rest when a catch-all "*" alias misses:
// 30,000 package imports through `"*": ["src/*", ...]` took 3.2s, and 0.7s with it.
const resolvedFile =
  (sources: ReadonlySet<string>) =>
  (base: string): Option.Option<string> =>
    pipe(
      firstOf(base, (file) => sources.has(file)),
      Option.orElse(() =>
        pipe(
          Option.liftPredicate(path.dirname(base), isDirectory),
          Option.flatMap(() => firstOf(base, isFile)),
        ),
      ),
    );

const realPathOf = (file: string): Option.Option<string> => Result.getSuccess(readRealPath(file));

// A workspace package linked into node_modules loads its own files, which an alias to its source
// reaches too: foodspring's apps/admin maps @foodspring/shared-ui to that package's src/index.ts.
// The listed names spare a realpath per aliased import: on macaron-front's 9,146 `~/` imports
// those cost 0.9s.
const installedAs =
  (nodeModules: ReadonlyArray<NodeModules>, name: PackageName) =>
  (file: string): boolean =>
    pipe(
      Array.findFirst(nodeModules, ({ dir, names }) =>
        pipe(
          Option.liftPredicate(path.join(dir, name), () => names.has(firstSegment(name))),
          Option.flatMap(realPathOf),
        ),
      ),
      Option.exists((installed) =>
        Option.exists(realPathOf(file), String.startsWith(`${installed}${path.sep}`)),
      ),
    );

type Lookup = {
  readonly name: PackageName;
  readonly resolved: (base: string) => Option.Option<string>;
  readonly installed: (file: string) => boolean;
};

const localPackages =
  ({ name, installed }: Lookup) =>
  (file: string): ReadonlyArray<PackageName> =>
    Option.match(Option.liftPredicate(file, installed), {
      onNone: () => [],
      onSome: () => [name],
    });

const firstSegment = (specifier: string): string =>
  Array.headNonEmpty(String.split(specifier, '/'));

// Tested below the tsconfig's directory, so a project stored inside a node_modules keeps its files.
const THROUGH_NODE_MODULES = /^(?:.*\/)?node_modules\//;

const isInstalled = (relative: string): boolean => THROUGH_NODE_MODULES.test(relative);

const installedPackage = (relative: string): ReadonlyArray<PackageName> =>
  Option.toArray(extractPackageName(relative.replace(THROUGH_NODE_MODULES, '')));

const baseUrlPackages = (
  baseUrl: BaseUrl,
  specifier: string,
  lookup: Lookup,
): ReadonlyArray<PackageName> => {
  const file = path.join(baseUrl.dir, specifier);
  return Match.value(path.relative(baseUrl.root, file)).pipe(
    Match.when(isInstalled, installedPackage),
    Match.orElse(() =>
      pipe(
        Option.liftPredicate(file, () => baseUrl.names.has(firstSegment(specifier))),
        Option.flatMap(lookup.resolved),
        Option.match({ onNone: () => [lookup.name], onSome: localPackages(lookup) }),
      ),
    ),
  );
};

// tsc tries a matched alias's targets in order; with none resolving it goes to node_modules.
const compilerPackages =
  (specifier: string, lookup: Lookup) =>
  (compiler: CompilerResolution): ReadonlyArray<PackageName> =>
    Option.match(bestMatch(compiler.paths, specifier), {
      onSome: ({ entry, captured }) =>
        pipe(
          Array.findFirst(entry.targets, (target) =>
            PathTarget.$match(target, {
              Installed: ({ template }) =>
                Option.some(Option.toArray(extractPackageName(filled(template, captured)))),
              Local: ({ template }) =>
                Option.map(lookup.resolved(filled(template, captured)), localPackages(lookup)),
              Declaration: ({ template }) =>
                Option.as(lookup.resolved(filled(template, captured)), [lookup.name]),
            }),
          ),
          Option.getOrElse(() => [lookup.name]),
        ),
      onNone: () =>
        Option.match(compiler.baseUrl, {
          onNone: () => [lookup.name],
          onSome: (baseUrl) => baseUrlPackages(baseUrl, specifier, lookup),
        }),
    });

// The packages a specifier loads: a # import through its package.json "imports", any other bare
// specifier through the paths and baseUrl of each tsconfig that compiles the file, else by name.
export const packagesOf = (
  resolution: ModuleResolution,
): ((specifier: string) => ReadonlyArray<PackageName>) => {
  const resolved = resolvedFile(resolution.sources);
  return Match.type<string>().pipe(
    Match.when(String.startsWith('#'), (subpath) =>
      subpathPackages(resolution.subpathImports, subpath),
    ),
    Match.orElse((specifier) => {
      const bare = specifier.replace(QUERY_OR_FRAGMENT, '');
      return Option.match(extractPackageName(bare), {
        onNone: (): ReadonlyArray<PackageName> => [],
        onSome: (name) =>
          Array.match(resolution.compilers, {
            onEmpty: () => [name],
            onNonEmpty: (compilers) =>
              Array.dedupe(
                Array.flatMap(
                  compilers,
                  compilerPackages(bare, {
                    name,
                    resolved,
                    installed: installedAs(resolution.nodeModules, name),
                  }),
                ),
              ),
          }),
      });
    }),
  );
};

const topLevelNames = (dir: string): Gathered<string> =>
  gatherOptional(
    Result.map(readDirectory(dir), (entries) =>
      Array.flatMap(entries, (entry) =>
        entry.isDirectory() ? [entry.name] : [entry.name, path.parse(entry.name).name],
      ),
    ),
  );

const entryNames = (dir: string): Gathered<string> =>
  gatherOptional(
    Result.map(
      readDirectory(dir),
      Array.map((entry) => entry.name),
    ),
  );

const namesNothingIn =
  (names: ReadonlySet<string>) =>
  (target: string): boolean =>
    !target.startsWith('.') &&
    !path.isAbsolute(target) &&
    !firstSegment(target).includes('*') &&
    !names.has(firstSegment(target));

// A target that resolves through node_modules, or a bare one whose first segment names nothing in
// its base directory, is a package; any other resolves inside the project.
const pathTargetOf =
  (base: string, names: ReadonlySet<string>, root: string) =>
  (target: string): PathTarget => {
    const resolved = path.resolve(base, target);
    const relative = path.relative(root, resolved);
    return Match.value(target).pipe(
      Match.when(
        (declaration) => DECLARATION_FILE_PATTERN.test(declaration),
        () => PathTarget.Declaration({ template: resolved }),
      ),
      Match.when(
        () => isInstalled(relative),
        () => PathTarget.Installed({ template: relative.replace(THROUGH_NODE_MODULES, '') }),
      ),
      Match.when(namesNothingIn(names), (bare) => PathTarget.Installed({ template: bare })),
      Match.orElse(() => PathTarget.Local({ template: resolved })),
    );
  };

type Compiled = {
  readonly resolution: CompilerResolution;
  readonly skipped: ReadonlyArray<FileError>;
};

// Paths resolve from baseUrl when one is set, else from the tsconfig that sets them.
const compilerResolutionOf = (chain: TsConfigChain): Compiled => {
  const baseUrl = Option.map(
    setWhere((config) => config.compilerOptions?.baseUrl)(chain),
    ({ dir, value }) => ({ dir: path.resolve(dir, value), root: dir }),
  );
  const paths = setWhere((config) => config.compilerOptions?.paths)(chain);
  const base = pipe(
    Option.orElse(
      Option.map(baseUrl, ({ dir }) => dir),
      () => Option.map(paths, ({ dir }) => dir),
    ),
    Option.map((dir) => ({ dir, listed: topLevelNames(dir) })),
  );
  const names = new Set(
    Option.match(base, { onNone: () => [], onSome: ({ listed }) => listed.found }),
  );
  return {
    resolution: {
      paths: Option.match(Option.all([paths, base]), {
        onNone: () => [],
        onSome: ([{ value, dir: root }, { dir }]) =>
          Array.map(Record.toEntries(value), ([key, targets]) => ({
            key,
            targets: Array.map(targets, pathTargetOf(dir, names, root)),
          })),
      }),
      baseUrl: Option.map(baseUrl, ({ dir, root }): BaseUrl => ({ dir, names, root })),
    },
    skipped: Option.match(base, { onNone: () => [], onSome: ({ listed }) => listed.skipped }),
  };
};

// A file resolves # imports through the package.json of the nearest directory above it.
export const resolutionOf = (
  manifests: ReadonlyArray<LayoutManifest>,
  chains: ReadonlyArray<TsConfigChain>,
  sources: ReadonlySet<string>,
): {
  readonly resolve: (file: string) => ModuleResolution;
  readonly skipped: ReadonlyArray<FileError>;
} => {
  const byDirectory = Record.fromEntries(
    Array.map(manifests, (manifest) => [path.resolve(path.dirname(manifest.path)), manifest]),
  );
  const compiled = Array.map(chains, (chain) => [chain, compilerResolutionOf(chain)] as const);
  const compilersOf = compiledBy(
    Array.map(compiled, ([chain, { resolution }]) => [chain, resolution] as const),
  );
  const listed = Array.map(
    [...new Set(Array.flatMap([...sources], (file) => lineage(path.dirname(file))))],
    (dir) => [dir, entryNames(path.join(dir, 'node_modules'))] as const,
  );
  const nodeModulesAt = Record.fromEntries(
    Array.map(
      listed,
      ([dir, { found }]) =>
        [dir, { dir: path.join(dir, 'node_modules'), names: new Set(found) }] as const,
    ),
  );
  return {
    resolve: (file) => ({
      subpathImports: pipe(
        lineage(path.dirname(file)),
        Array.findFirst((dir) => Record.get(byDirectory, dir)),
        Option.match({ onNone: () => [], onSome: (manifest) => manifest.subpathImports }),
      ),
      compilers: compilersOf(file),
      sources,
      nodeModules: Array.flatMap(lineage(path.dirname(file)), (dir) =>
        Option.toArray(Record.get(nodeModulesAt, dir)),
      ),
    }),
    skipped: [
      ...Array.flatMap(compiled, ([, { skipped }]) => skipped),
      ...Array.flatMap(listed, ([, { skipped }]) => skipped),
    ],
  };
};
