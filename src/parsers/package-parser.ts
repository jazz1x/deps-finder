import { Result, Schema, pipe } from 'effect';
import type { FileError } from '../domain/errors.js';
import type { PackageJson, PackageName } from '../domain/types.js';
import { readJsonFile } from '../utils/file-reader.js';

export const DependencySection = Schema.optionalKey(
  Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
);

const PackageJsonFile = Schema.Struct({
  dependencies: DependencySection,
  devDependencies: DependencySection,
  peerDependencies: DependencySection,
});

const namesOf = (
  section: Readonly<Record<string, unknown>> | null | undefined,
): ReadonlyArray<PackageName> => Object.keys(section ?? {});

export const readPackageJson = (path: string): Result.Result<PackageJson, FileError> =>
  pipe(
    readJsonFile(PackageJsonFile)(path),
    Result.map((file) => ({
      dependencies: namesOf(file.dependencies),
      devDependencies: namesOf(file.devDependencies),
      peerDependencies: namesOf(file.peerDependencies),
    })),
  );
