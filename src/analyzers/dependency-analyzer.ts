import { Array, Option, Record, pipe } from 'effect';
import type {
  AnalysisResult,
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

const isUnused =
  (runtime: UsageIndex, typeOnly: UsageIndex) =>
  (dep: PackageName): boolean =>
    !Record.has(runtime, dep) && !Record.has(typeOnly, dep);

const findMisplaced = (
  devDependencies: ReadonlyArray<PackageName>,
  runtime: UsageIndex,
): ReadonlyArray<DependencyUsage> =>
  pipe(
    devDependencies,
    Array.map((dep) =>
      pipe(
        Record.get(runtime, dep),
        Option.map((locations) =>
          deduplicateLocations(Array.filter(locations, (loc) => !isProductionConfigFile(loc.file))),
        ),
        Option.filter(Array.isReadonlyArrayNonEmpty),
        Option.map((locations): DependencyUsage => ({ packageName: dep, locations })),
      ),
    ),
    Array.getSomes,
  );

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
  const { dependencies, devDependencies, peerDependencies } = packageJson;
  const runtime = indexUsage(allImports, 'runtime');
  const typeOnly = indexUsage(allImports, 'type-only');
  const notIgnored = (name: PackageName): boolean => !Array.contains(options.ignoredPackages, name);

  const declaredForUnused = options.checkAll
    ? [...dependencies, ...peerDependencies, ...devDependencies]
    : dependencies;

  const unused = pipe(
    declaredForUnused,
    Array.filter(isUnused(runtime, typeOnly)),
    Array.filter(notIgnored),
  );

  const unusedPeer =
    options.checkAll || options.checkPeer === true
      ? pipe(peerDependencies, Array.filter(isUnused(runtime, typeOnly)), Array.filter(notIgnored))
      : [];

  const typeOnlyUsed = pipe(
    declaredForUnused,
    Array.filter((dep) => Record.has(typeOnly, dep) && !Record.has(runtime, dep)),
    Array.filter(notIgnored),
  );

  const misplaced = options.checkAll
    ? []
    : pipe(
        findMisplaced(devDependencies, runtime),
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
