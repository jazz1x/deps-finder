import { Array, Match, Record, Result, Schema, pipe } from 'effect';
import type { FileError } from '../domain/errors.js';
import type { PackageJson, PackageName } from '../domain/types.js';
import { lenientKey, readJsonFile } from '../utils/file-reader.js';

const DependencySection = Schema.optionalKey(
  Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
);

type ExportsTarget =
  | string
  | null
  | ReadonlyArray<ExportsTarget>
  | { readonly [condition: string]: ExportsTarget };

const ExportsTarget: Schema.Codec<ExportsTarget> = Schema.Union([
  Schema.String,
  Schema.Null,
  Schema.Array(Schema.suspend((): Schema.Codec<ExportsTarget> => ExportsTarget)),
  Schema.Record(
    Schema.String,
    Schema.suspend((): Schema.Codec<ExportsTarget> => ExportsTarget),
  ),
]);

const PackageJsonFile = Schema.Struct({
  dependencies: DependencySection,
  devDependencies: DependencySection,
  peerDependencies: DependencySection,
  types: lenientKey(Schema.NonEmptyString),
  typings: lenientKey(Schema.NonEmptyString),
  exports: lenientKey(ExportsTarget),
});

const namesOf = (
  section: Readonly<Record<string, unknown>> | null | undefined,
): ReadonlyArray<PackageName> => Object.keys(section ?? {});

const isTargetList = (target: ExportsTarget): target is ReadonlyArray<ExportsTarget> =>
  Array.isArray(target);

// The targets of every "types" condition, at any depth.
const typesConditions = (target: ExportsTarget | undefined): ReadonlyArray<ExportsTarget> =>
  Match.value(target).pipe(
    Match.when(Match.string, (): ReadonlyArray<ExportsTarget> => []),
    Match.when(Match.null, (): ReadonlyArray<ExportsTarget> => []),
    Match.when(Match.undefined, (): ReadonlyArray<ExportsTarget> => []),
    Match.when(isTargetList, (targets) => Array.flatMap(targets, typesConditions)),
    Match.when(Match.record, (conditions) =>
      Array.flatMap(Record.toEntries(conditions), ([condition, nested]) => [
        ...(condition === 'types' ? [nested] : []),
        ...typesConditions(nested),
      ]),
    ),
    Match.exhaustive,
  );

const declarationsOf = (file: typeof PackageJsonFile.Type): PackageJson['declarations'] =>
  Array.match(
    [
      ...Array.filter([file.types, file.typings], (entry) => entry !== undefined),
      ...typesConditions(file.exports),
    ],
    { onEmpty: () => 'none', onNonEmpty: () => 'published' },
  );

export const readPackageJson = (path: string): Result.Result<PackageJson, FileError> =>
  pipe(
    readJsonFile(PackageJsonFile)(path),
    Result.map((file) => ({
      dependencies: namesOf(file.dependencies),
      devDependencies: namesOf(file.devDependencies),
      peerDependencies: namesOf(file.peerDependencies),
      declarations: declarationsOf(file),
    })),
  );
