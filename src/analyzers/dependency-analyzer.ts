import { builtinModules } from 'node:module';
import { Array, Match, Option, Order, Record, String, pipe } from 'effect';
import type {
  AnalysisResult,
  DependencyType,
  DependencyUsage,
  ImportDetails,
  ImportLocation,
  ImportType,
  PackageJson,
  PackageName,
} from '../domain/types.js';
import { deduplicateLocations } from '../utils/deduplicate.js';

type UsageIndex = Readonly<Record<PackageName, ReadonlyArray<ImportLocation>>>;

const locationOf = (detail: ImportDetails): ImportLocation => ({
  file: detail.file,
  line: detail.line,
  importStatement: detail.importStatement,
});

const indexUsage = (imports: ReadonlyArray<ImportDetails>): UsageIndex =>
  pipe(
    imports,
    Array.groupBy((detail) => detail.packageName),
    Record.map(Array.map(locationOf)),
  );

const ofType =
  (importType: ImportType) =>
  (detail: ImportDetails): boolean =>
    detail.importType === importType;

const bySourcePosition = Order.combine(
  Order.mapInput(Order.String, (loc: ImportLocation) => loc.file),
  Order.mapInput(Order.Number, (loc: ImportLocation) => loc.line),
);

const isBuiltin = (name: PackageName): boolean => Array.contains(builtinModules, name);

const isBun = (name: PackageName): boolean => name === 'bun' || String.startsWith('bun:')(name);

const typesPackagesOf = (name: PackageName): ReadonlyArray<PackageName> =>
  Match.value(name).pipe(
    Match.when(String.startsWith('node:'), () => ['@types/node']),
    Match.when(isBun, () => ['@types/bun']),
    Match.when(isBuiltin, (builtin) => ['@types/node', `@types/${builtin}`]),
    Match.when(String.startsWith('@'), (scoped) => [
      `@types/${String.replace('/', '__')(scoped.slice(1))}`,
    ]),
    Match.orElse((bare) => [`@types/${bare}`]),
  );

// An @types package is used through the package it types, which never makes it misplaced or typeOnly.
const usedNames = (used: UsageIndex): ReadonlySet<PackageName> =>
  new Set(Array.flatMap(Record.keys(used), (name) => [name, ...typesPackagesOf(name)]));

const isUnused =
  (used: ReadonlySet<PackageName>) =>
  (dep: PackageName): boolean =>
    !used.has(dep);

const findMisplaced = (
  packageJson: PackageJson,
  productionRuntime: UsageIndex,
): ReadonlyArray<DependencyUsage> =>
  pipe(
    packageJson.devDependencies,
    Array.filter(
      (dep) =>
        !Array.contains(packageJson.dependencies, dep) &&
        !Array.contains(packageJson.peerDependencies, dep),
    ),
    Array.map((dep) =>
      pipe(
        Record.get(productionRuntime, dep),
        Option.map((locations): DependencyUsage => ({
          packageName: dep,
          locations: Array.sort(deduplicateLocations(locations), bySourcePosition),
        })),
      ),
    ),
    Array.getSomes,
  );

export type AnalyzeOptions = {
  readonly sections: ReadonlyArray<DependencyType>;
  readonly ignoredPackages: ReadonlyArray<string>;
};

const declaredIn =
  (packageJson: PackageJson, sections: ReadonlyArray<DependencyType>) =>
  (...wanted: ReadonlyArray<DependencyType>): ReadonlyArray<PackageName> =>
    pipe(
      wanted,
      Array.filter((section) => Array.contains(sections, section)),
      Array.flatMap((section) => packageJson[section]),
      Array.dedupe,
    );

export const analyzeDependencies = (
  packageJson: PackageJson,
  allImports: ReadonlyArray<ImportDetails>,
  options: AnalyzeOptions,
): AnalysisResult => {
  const used = usedNames(indexUsage(allImports));
  const production = Array.filter(allImports, (detail) => detail.context === 'production');
  const productionRuntime = indexUsage(Array.filter(production, ofType('runtime')));
  const productionTypeOnly = indexUsage(Array.filter(production, ofType('type-only')));
  const notIgnored = (name: PackageName): boolean => !Array.contains(options.ignoredPackages, name);
  const declared = declaredIn(packageJson, options.sections);

  const peers = pipe(
    declared('peerDependencies'),
    Array.filter((dep) => !Array.contains(packageJson.dependencies, dep)),
  );

  const unused = pipe(
    declared('dependencies', 'devDependencies'),
    Array.filter((dep) => !Array.contains(peers, dep)),
    Array.filter(isUnused(used)),
    Array.filter(notIgnored),
  );

  const unusedPeer = pipe(peers, Array.filter(isUnused(used)), Array.filter(notIgnored));

  // Published declarations import these types, so consumers need them installed.
  const typeOnlyUsed = Match.value(packageJson.declarations).pipe(
    Match.when('published', (): ReadonlyArray<PackageName> => []),
    Match.when('none', () =>
      pipe(
        packageJson.dependencies,
        Array.filter(
          (dep) => Record.has(productionTypeOnly, dep) && !Record.has(productionRuntime, dep),
        ),
        Array.filter(notIgnored),
      ),
    ),
    Match.exhaustive,
  );

  const misplaced = pipe(
    findMisplaced(packageJson, productionRuntime),
    Array.filter((usage) => notIgnored(usage.packageName)),
  );

  return {
    unused,
    unusedPeer,
    misplaced,
    typeOnly: typeOnlyUsed,
    totalIssues: unused.length + unusedPeer.length + misplaced.length + typeOnlyUsed.length,
  };
};
