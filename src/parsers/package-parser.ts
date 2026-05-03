import { A, D, O, R, pipe } from '@mobily/ts-belt';
import type { FileError } from '../domain/errors.js';
import type { DependencyType, PackageJson, PackageName } from '../domain/types.js';
import { readJSONFile } from '../utils/file-reader.js';
import { isPlainObject } from '../utils/type-guards.js';

type RawPackageJson = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

export const readPackageJson = (path: string): R.Result<PackageJson, FileError> =>
  pipe(
    readJSONFile<unknown>(path),
    R.flatMap((content): R.Result<PackageJson, FileError> => {
      if (!isPlainObject(content)) {
        return R.Error({
          type: 'PARSE_ERROR',
          path,
          error: new Error('package.json root must be a JSON object'),
        });
      }
      const c = content as RawPackageJson;
      return R.Ok({
        name: O.fromNullable(c.name),
        version: O.fromNullable(c.version),
        dependencies: O.fromNullable(c.dependencies),
        devDependencies: O.fromNullable(c.devDependencies),
        peerDependencies: O.fromNullable(c.peerDependencies),
      });
    }),
  );

export const extractDependencies = (
  packageJson: PackageJson,
  type: DependencyType,
): ReadonlyArray<PackageName> => O.mapWithDefault(packageJson[type], [], D.keys);

const mergeDependencyKeys = (
  packageJson: PackageJson,
  types: ReadonlyArray<DependencyType>,
): ReadonlyArray<PackageName> =>
  pipe(
    types,
    A.map((type) => extractDependencies(packageJson, type)),
    A.flat,
    A.uniq,
  );

export const extractAllDependencies = (packageJson: PackageJson): ReadonlyArray<PackageName> =>
  mergeDependencyKeys(packageJson, ['dependencies', 'devDependencies', 'peerDependencies']);

export const extractProductionDependencies = (
  packageJson: PackageJson,
): ReadonlyArray<PackageName> => mergeDependencyKeys(packageJson, ['dependencies']);
