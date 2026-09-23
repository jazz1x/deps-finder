import { Array, Option, Order, Record, pipe } from 'effect';
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
import { isProductionConfigFile } from '../parsers/import-parser.js';
import { deduplicateLocations } from '../utils/deduplicate.js';

type UsageIndex = Readonly<Record<PackageName, ReadonlyArray<ImportLocation>>>;

const locationOf = (detail: ImportDetails): ImportLocation => ({
  file: detail.file,
  line: detail.line,
  importStatement: detail.importStatement,
});

const indexUsage = (imports: ReadonlyArray<ImportDetails>, importType: ImportType): UsageIndex =>
  pipe(
    imports,
    Array.filter((detail) => detail.importType === importType),
    Array.groupBy((detail) => detail.packageName),
    Record.map(Array.map(locationOf)),
  );

const bySourcePosition = Order.combine(
  Order.mapInput(Order.String, (loc: ImportLocation) => loc.file),
  Order.mapInput(Order.Number, (loc: ImportLocation) => loc.line),
);

const isUnused =
  (runtime: UsageIndex, typeOnly: UsageIndex) =>
  (dep: PackageName): boolean =>
    !Record.has(runtime, dep) && !Record.has(typeOnly, dep);

const findMisplaced = (
  packageJson: PackageJson,
  runtime: UsageIndex,
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
        Record.get(runtime, dep),
        Option.map((locations) =>
          pipe(
            locations,
            Array.filter((loc) => !isProductionConfigFile(loc.file)),
            deduplicateLocations,
            (unique) => Array.sort(unique, bySourcePosition),
          ),
        ),
        Option.filter((locations) => Array.isReadonlyArrayNonEmpty(locations)),
        Option.map((locations): DependencyUsage => ({ packageName: dep, locations })),
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
  const runtime = indexUsage(allImports, 'runtime');
  const typeOnly = indexUsage(allImports, 'type-only');
  const notIgnored = (name: PackageName): boolean => !Array.contains(options.ignoredPackages, name);
  const declared = declaredIn(packageJson, options.sections);

  const unused = pipe(
    declared('dependencies', 'devDependencies'),
    Array.filter(isUnused(runtime, typeOnly)),
    Array.filter(notIgnored),
  );

  const unusedPeer = pipe(
    declared('peerDependencies'),
    Array.filter((dep) => !Array.contains(packageJson.dependencies, dep)),
    Array.filter(isUnused(runtime, typeOnly)),
    Array.filter(notIgnored),
  );

  const typeOnlyUsed = pipe(
    packageJson.dependencies,
    Array.filter((dep) => Record.has(typeOnly, dep) && !Record.has(runtime, dep)),
    Array.filter(notIgnored),
  );

  const misplaced = pipe(
    findMisplaced(packageJson, runtime),
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
