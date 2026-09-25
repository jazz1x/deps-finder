import path from 'node:path';
import { Array, Match, Option, Order, Record, String, pipe } from 'effect';
import type { ModuleResolution, PackageName, SubpathImport } from '../domain/types.js';
import { lineage } from '../utils/project-walk.js';
import type { LayoutManifest } from './package-parser.js';

// A bundler's ?raw or #fragment suffix is not part of the name; a leading # is a subpath import.
const PACKAGE_NAME = /^(?![./]|https?:|file:)(@[^/?#]+\/[^/?#]+|[^@/?#][^/?#]*)/;

export const extractPackageName = (specifier: string): Option.Option<string> =>
  Option.fromNullishOr(PACKAGE_NAME.exec(specifier)?.[1]);

export const NO_RESOLUTION: ModuleResolution = { subpathImports: [] };

type SubpathMatch = {
  readonly entry: SubpathImport;
  readonly captured: string;
  readonly prefixLength: number;
};

// Node prefers an exact key, then the pattern with the longest prefix before its "*".
const byPrecedence = Order.combine(
  Order.mapInput(Order.Number, (match: SubpathMatch) => match.prefixLength),
  Order.mapInput(Order.Number, (match: SubpathMatch) => match.entry.key.length),
);

const subpathMatchOf =
  (specifier: string) =>
  (entry: SubpathImport): Option.Option<SubpathMatch> =>
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

const subpathPackages = (
  subpathImports: ReadonlyArray<SubpathImport>,
  specifier: string,
): ReadonlyArray<PackageName> =>
  pipe(
    Array.getSomes(Array.map(subpathImports, subpathMatchOf(specifier))),
    Array.match({
      onEmpty: (): ReadonlyArray<PackageName> => [],
      onNonEmpty: (matches) =>
        pipe(Array.max(matches, byPrecedence), ({ entry, captured }) =>
          Array.flatMap(entry.targets, (target) =>
            Option.toArray(extractPackageName(String.replaceAll('*', captured)(target))),
          ),
        ),
    }),
  );

// The packages a specifier loads: a # import through its package.json "imports", any other bare
// specifier by its name.
export const packagesOf =
  (resolution: ModuleResolution) =>
  (specifier: string): ReadonlyArray<PackageName> =>
    Match.value(specifier).pipe(
      Match.when(String.startsWith('#'), (subpath) =>
        subpathPackages(resolution.subpathImports, subpath),
      ),
      Match.orElse((bare) => Option.toArray(extractPackageName(bare))),
    );

// A file resolves # imports through the package.json of the nearest directory above it.
export const resolutionOf = (
  manifests: ReadonlyArray<LayoutManifest>,
): ((file: string) => ModuleResolution) => {
  const byDirectory = Record.fromEntries(
    Array.map(manifests, (manifest) => [path.resolve(path.dirname(manifest.path)), manifest]),
  );
  return (file) =>
    pipe(
      lineage(path.dirname(file)),
      Array.findFirst((dir) => Record.get(byDirectory, dir)),
      Option.match({
        onNone: () => NO_RESOLUTION,
        onSome: (manifest) => ({ subpathImports: manifest.subpathImports }),
      }),
    );
};
