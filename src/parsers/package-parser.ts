import { Array, Effect, Match, Record, Result, Schema, pipe } from 'effect';
import type { FileError } from '../domain/errors.js';
import type { PackageJson, PackageName } from '../domain/types.js';
import { readJsonFile } from '../utils/file-reader.js';

const DependencySection = Schema.optionalKey(
  Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
);

const DeclarationEntry = Schema.optionalKey(
  Schema.NonEmptyString.pipe(Schema.catchDecoding(() => Effect.succeedNone)),
);

const PackageJsonFile = Schema.Struct({
  dependencies: DependencySection,
  devDependencies: DependencySection,
  peerDependencies: DependencySection,
  types: DeclarationEntry,
  typings: DeclarationEntry,
  exports: Schema.optionalKey(Schema.Unknown),
});

const namesOf = (
  section: Readonly<Record<string, unknown>> | null | undefined,
): ReadonlyArray<PackageName> => Object.keys(section ?? {});

const hasTypesCondition = (exports: unknown): boolean =>
  Match.value(exports).pipe(
    Match.when(globalThis.Array.isArray, (targets) => Array.some(targets, hasTypesCondition)),
    Match.when(Match.record, (conditions) =>
      Array.some(
        Record.toEntries(conditions),
        ([condition, target]) => condition === 'types' || hasTypesCondition(target),
      ),
    ),
    Match.orElse(() => false),
  );

const publishesDeclarations = (file: typeof PackageJsonFile.Type): boolean =>
  Array.some([file.types, file.typings], (entry) => entry !== undefined) ||
  hasTypesCondition(file.exports);

export const readPackageJson = (path: string): Result.Result<PackageJson, FileError> =>
  pipe(
    readJsonFile(PackageJsonFile)(path),
    Result.map((file) => ({
      dependencies: namesOf(file.dependencies),
      devDependencies: namesOf(file.devDependencies),
      peerDependencies: namesOf(file.peerDependencies),
      declarations: publishesDeclarations(file) ? 'published' : 'none',
    })),
  );
