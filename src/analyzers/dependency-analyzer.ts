import { A, D, O, pipe } from '@mobily/ts-belt';
import { match } from 'ts-pattern';
import type {
  AnalysisResult,
  DependencyUsage,
  ImportDetails,
  ImportLocation,
  PackageJson,
  PackageName,
} from '../domain/types.js';
import { isProductionConfigFile } from '../parsers/import-parser.js';
import { deduplicateLocations } from '../utils/deduplicate.js';

type DependencyCategory = 'dependencies' | 'peerDependencies' | 'devDependencies';

const extractDependenciesByCategory = (
  packageJson: PackageJson,
  category: DependencyCategory,
): ReadonlyArray<string> => O.mapWithDefault(packageJson[category], [], D.keys);

type CategorizedImports = {
  runtime: Map<PackageName, ImportLocation[]>;
  typeOnly: Map<PackageName, ImportLocation[]>;
};

const categorizeImports = (imports: ReadonlyArray<ImportDetails>): CategorizedImports =>
  A.reduce(
    imports,
    {
      runtime: new Map<PackageName, ImportLocation[]>(),
      typeOnly: new Map<PackageName, ImportLocation[]>(),
    },
    (acc, detail) => {
      const loc: ImportLocation = {
        file: detail.file,
        line: detail.line,
        importStatement: detail.importStatement,
      };

      match(detail.importType)
        .with('runtime', () => {
          const list = acc.runtime.get(detail.packageName) || [];
          list.push(loc);
          acc.runtime.set(detail.packageName, list);
        })
        .otherwise(() => {
          const list = acc.typeOnly.get(detail.packageName) || [];
          list.push(loc);
          acc.typeOnly.set(detail.packageName, list);
        });
      return acc;
    },
  );

const findUnusedIn = (
  declared: ReadonlyArray<string>,
  usedRuntime: Map<PackageName, ImportLocation[]>,
  usedTypeOnly: Map<PackageName, ImportLocation[]>,
): ReadonlyArray<string> =>
  A.filter(declared, (dep) => !usedRuntime.has(dep) && !usedTypeOnly.has(dep));

const findMisplaced = (
  packageJson: PackageJson,
  usedRuntime: Map<PackageName, ImportLocation[]>,
): ReadonlyArray<DependencyUsage> => {
  const devDeps = extractDependenciesByCategory(packageJson, 'devDependencies');

  return A.filterMap(devDeps, (dep) => {
    const locations = usedRuntime.get(dep);
    if (!locations) return O.None;

    const problematicLocations = A.filter(locations, (loc) => !isProductionConfigFile(loc.file));
    const uniqueLocations = deduplicateLocations(problematicLocations);

    return match(uniqueLocations)
      .with([], () => O.None)
      .otherwise((locs) =>
        O.Some({
          packageName: dep,
          locations: locs,
        }),
      );
  });
};

const filterIgnored = <T extends string | DependencyUsage>(
  items: ReadonlyArray<T>,
  ignoredPackages: ReadonlyArray<string>,
): ReadonlyArray<T> =>
  A.filter(items, (item) => {
    const pkgName = typeof item === 'string' ? item : item.packageName;
    return !A.includes(ignoredPackages, pkgName);
  });

export type AnalyzeOptions = {
  readonly checkAll: boolean;
  readonly checkPeer?: boolean;
  readonly ignoredPackages: ReadonlyArray<string>;
};

export const analyzeDependencies = (
  packageJson: PackageJson,
  allImports: ReadonlyArray<ImportDetails>,
  options: AnalyzeOptions,
): AnalysisResult => {
  const includePeer = options.checkAll || options.checkPeer === true;

  const deps = extractDependenciesByCategory(packageJson, 'dependencies');
  const peerDeps = extractDependenciesByCategory(packageJson, 'peerDependencies');
  const devDeps = extractDependenciesByCategory(packageJson, 'devDependencies');

  const declaredForUnused: ReadonlyArray<string> = match(options.checkAll)
    .with(true, () => [...deps, ...peerDeps, ...devDeps])
    .otherwise(() => [...deps]);

  const { runtime: runtimeUsedDeps, typeOnly: typeOnlyUsedDeps } = categorizeImports(allImports);

  const unused = pipe(findUnusedIn(declaredForUnused, runtimeUsedDeps, typeOnlyUsedDeps), (xs) =>
    filterIgnored(xs, options.ignoredPackages),
  );

  const unusedPeer = match(includePeer)
    .with(false, () => [] as ReadonlyArray<string>)
    .otherwise(() =>
      pipe(findUnusedIn(peerDeps, runtimeUsedDeps, typeOnlyUsedDeps), (xs) =>
        filterIgnored(xs, options.ignoredPackages),
      ),
    );

  const typeOnlyDeclared = match(options.checkAll)
    .with(true, () => declaredForUnused)
    .otherwise(() => deps);

  const finalTypeOnly = pipe(
    typeOnlyDeclared,
    A.filter((dep) => typeOnlyUsedDeps.has(dep) && !runtimeUsedDeps.has(dep)),
    (xs) => filterIgnored(xs, options.ignoredPackages),
  );

  const misplaced = match(options.checkAll)
    .with(true, () => [])
    .otherwise(() =>
      pipe(findMisplaced(packageJson, runtimeUsedDeps), (xs) =>
        filterIgnored(xs, options.ignoredPackages),
      ),
    );

  return {
    unused,
    unusedPeer,
    misplaced,
    typeOnly: finalTypeOnly,
    totalIssues:
      A.length(unused) + A.length(unusedPeer) + A.length(misplaced) + A.length(finalTypeOnly),
  };
};
