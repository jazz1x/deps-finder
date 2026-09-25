import path from 'node:path';
import { Array, Match, Option, Order, Record, Result, String, pipe } from 'effect';
import type { FileError } from '../domain/errors.js';
import {
  type BaseUrl,
  type CompilerResolution,
  type Gathered,
  type ModuleResolution,
  type PackageName,
  PathTarget,
  type SubpathImport,
} from '../domain/types.js';
import { gatherOptional, isFile, readDirectory } from '../utils/file-reader.js';
import { lineage } from '../utils/project-walk.js';
import type { TsConfigChain } from '../utils/tsconfig-reader.js';
import { governedBy, setWhere } from './emit-settings.js';
import type { LayoutManifest } from './package-parser.js';

// A bundler's ?raw or #fragment suffix is not part of the name; a leading # is a subpath import.
const PACKAGE_NAME = /^(?![./]|https?:|file:)(@[^/?#]+\/[^/?#]+|[^@/?#][^/?#]*)/;

export const extractPackageName = (specifier: string): Option.Option<string> =>
  Option.fromNullishOr(PACKAGE_NAME.exec(specifier)?.[1]);

export const NO_RESOLUTION: ModuleResolution = { subpathImports: [], compilers: [] };

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

const patternMatchOf =
  (specifier: string) =>
  <A extends { readonly key: string }>(entry: A): Option.Option<PatternMatch<A>> =>
    Match.value(String.split(entry.key, '*')).pipe(
      Match.when(
        (parts) => parts.length === 1,
        () =>
          Option.liftPredicate(
            { entry, captured: '', prefixLength: Number.POSITIVE_INFINITY },
            () => entry.key === specifier,
          ),
      ),
      Match.when(
        (parts) => parts.length === 2,
        ([prefix = '', suffix = '']) =>
          Option.liftPredicate(
            {
              entry,
              captured: specifier.slice(prefix.length, specifier.length - suffix.length),
              prefixLength: prefix.length,
            },
            () =>
              specifier.startsWith(prefix) &&
              specifier.endsWith(suffix) &&
              specifier.length >= entry.key.length,
          ),
      ),
      Match.orElse(() => Option.none()),
    );

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

const resolvesToFile = (base: string): boolean =>
  Array.some(
    [
      base,
      ...Array.map(RESOLVED_EXTENSIONS, (extension) => `${base}${extension}`),
      ...Array.map(RESOLVED_EXTENSIONS, (extension) => path.join(base, `index${extension}`)),
    ],
    isFile,
  );

const firstSegment = (specifier: string): string =>
  Array.headNonEmpty(String.split(specifier, '/'));

// tsc tries a matched alias's targets in order; with none resolving it goes to node_modules.
const compilerPackages =
  (specifier: string, name: PackageName) =>
  (compiler: CompilerResolution): ReadonlyArray<PackageName> =>
    Option.match(bestMatch(compiler.paths, specifier), {
      onSome: ({ entry, captured }) =>
        pipe(
          Array.findFirst(entry.targets, (target) =>
            PathTarget.$match(target, {
              Installed: ({ template }) =>
                Option.some(Option.toArray(extractPackageName(filled(template, captured)))),
              Local: ({ template }) =>
                Option.as(
                  Option.liftPredicate(filled(template, captured), resolvesToFile),
                  [] as ReadonlyArray<PackageName>,
                ),
            }),
          ),
          Option.getOrElse(() => [name]),
        ),
      onNone: () =>
        Option.match(compiler.baseUrl, {
          onNone: () => [name],
          onSome: (baseUrl) =>
            baseUrl.names.has(firstSegment(specifier)) &&
            resolvesToFile(path.join(baseUrl.dir, specifier))
              ? []
              : [name],
        }),
    });

// The packages a specifier loads: a # import through its package.json "imports", any other bare
// specifier through the paths and baseUrl of each tsconfig that compiles the file, else by name.
export const packagesOf =
  (resolution: ModuleResolution) =>
  (specifier: string): ReadonlyArray<PackageName> =>
    Match.value(specifier).pipe(
      Match.when(String.startsWith('#'), (subpath) =>
        subpathPackages(resolution.subpathImports, subpath),
      ),
      Match.orElse((bare) =>
        Option.match(extractPackageName(bare), {
          onNone: (): ReadonlyArray<PackageName> => [],
          onSome: (name) =>
            Array.match(resolution.compilers, {
              onEmpty: () => [name],
              onNonEmpty: (compilers) =>
                Array.dedupe(Array.flatMap(compilers, compilerPackages(bare, name))),
            }),
        }),
      ),
    );

const topLevelNames = (dir: string): Gathered<string> =>
  gatherOptional(
    Result.map(readDirectory(dir), (entries) =>
      Array.flatMap(entries, (entry) =>
        entry.isDirectory() ? [entry.name] : [entry.name, path.parse(entry.name).name],
      ),
    ),
  );

const THROUGH_NODE_MODULES = /^.*node_modules\//;

const namesNothingIn =
  (names: ReadonlySet<string>) =>
  (target: string): boolean =>
    !target.startsWith('.') &&
    !path.isAbsolute(target) &&
    !firstSegment(target).includes('*') &&
    !names.has(firstSegment(target));

// A target through node_modules, or a bare one whose first segment names nothing in its base
// directory, is a package; any other resolves inside the project.
const pathTargetOf =
  (base: string, names: ReadonlySet<string>) =>
  (target: string): PathTarget =>
    Match.value(target).pipe(
      Match.when(
        (installed) => THROUGH_NODE_MODULES.test(installed),
        (installed) =>
          PathTarget.Installed({ template: installed.replace(THROUGH_NODE_MODULES, '') }),
      ),
      Match.when(namesNothingIn(names), (bare) => PathTarget.Installed({ template: bare })),
      Match.orElse((local) => PathTarget.Local({ template: path.resolve(base, local) })),
    );

type Compiled = {
  readonly resolution: CompilerResolution;
  readonly skipped: ReadonlyArray<FileError>;
};

// Paths resolve from baseUrl when one is set, else from the tsconfig that sets them.
const compilerResolutionOf = (chain: TsConfigChain): Compiled => {
  const baseUrl = Option.map(
    setWhere((config) => config.compilerOptions?.baseUrl)(chain),
    ({ dir, value }) => path.resolve(dir, value),
  );
  const paths = setWhere((config) => config.compilerOptions?.paths)(chain);
  const base = pipe(
    Option.orElse(baseUrl, () => Option.map(paths, ({ dir }) => dir)),
    Option.map((dir) => ({ dir, listed: topLevelNames(dir) })),
  );
  const names = new Set(
    Option.match(base, { onNone: () => [], onSome: ({ listed }) => listed.found }),
  );
  return {
    resolution: {
      paths: Option.match(Option.all([paths, base]), {
        onNone: () => [],
        onSome: ([{ value }, { dir }]) =>
          Array.map(Record.toEntries(value), ([key, targets]) => ({
            key,
            targets: Array.map(targets, pathTargetOf(dir, names)),
          })),
      }),
      baseUrl: Option.map(baseUrl, (dir): BaseUrl => ({ dir, names })),
    },
    skipped: Option.match(base, { onNone: () => [], onSome: ({ listed }) => listed.skipped }),
  };
};

// A file resolves # imports through the package.json of the nearest directory above it.
export const resolutionOf = (
  manifests: ReadonlyArray<LayoutManifest>,
  chains: ReadonlyArray<TsConfigChain>,
): {
  readonly resolve: (file: string) => ModuleResolution;
  readonly skipped: ReadonlyArray<FileError>;
} => {
  const byDirectory = Record.fromEntries(
    Array.map(manifests, (manifest) => [path.resolve(path.dirname(manifest.path)), manifest]),
  );
  const compiled = Array.map(chains, (chain) => [chain, compilerResolutionOf(chain)] as const);
  const compilersOf = governedBy(
    Array.map(compiled, ([chain, { resolution }]) => [chain, resolution] as const),
  );
  return {
    resolve: (file) => ({
      subpathImports: pipe(
        lineage(path.dirname(file)),
        Array.findFirst((dir) => Record.get(byDirectory, dir)),
        Option.match({ onNone: () => [], onSome: (manifest) => manifest.subpathImports }),
      ),
      compilers: compilersOf(file),
    }),
    skipped: Array.flatMap(compiled, ([, { skipped }]) => skipped),
  };
};
