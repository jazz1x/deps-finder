import path from 'node:path';
import { Array, Match, Predicate, Record, Result, Schema, pipe } from 'effect';
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
  optionalDependencies: DependencySection,
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

// Tools that read their settings from a package.json key of the same name.
const TOOL_KEYS = [
  'eslintConfig',
  'babel',
  'postcss',
  'jest',
  'prettier',
  'stylelint',
  'commitlint',
  'lint-staged',
] as const;

export type ToolKey = (typeof TOOL_KEYS)[number];

const LayoutManifestFile = Schema.Struct({
  scripts: lenientKey(Schema.Record(Schema.String, Schema.Unknown)),
  bin: lenientKey(Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.String)])),
  eslintConfig: Schema.optionalKey(Schema.Unknown),
  babel: Schema.optionalKey(Schema.Unknown),
  postcss: Schema.optionalKey(Schema.Unknown),
  jest: Schema.optionalKey(Schema.Unknown),
  prettier: Schema.optionalKey(Schema.Unknown),
  stylelint: Schema.optionalKey(Schema.Unknown),
  commitlint: Schema.optionalKey(Schema.Unknown),
  'lint-staged': Schema.optionalKey(Schema.Unknown),
});

// bins: the files its "bin" runs, relative to the project root.
export type LayoutManifest = {
  readonly path: string;
  readonly scripts: Readonly<Record<string, string>>;
  readonly bins: ReadonlyArray<string>;
  readonly tools: ReadonlyArray<readonly [ToolKey, unknown]>;
};

const binTargetsOf = (bin: string | Readonly<Record<string, string>> | undefined) =>
  Match.value(bin).pipe(
    Match.when(Match.undefined, (): ReadonlyArray<string> => []),
    Match.when(Match.string, (target) => [target]),
    Match.orElse((targets) => Record.values(targets)),
  );

// layoutRoot is relative to rootDir, as the walk names it.
export const readLayoutManifest =
  (rootDir: string) =>
  (layoutRoot: string): Result.Result<LayoutManifest, FileError> =>
    pipe(
      readJsonFile(LayoutManifestFile)(path.join(rootDir, layoutRoot, 'package.json')),
      Result.map((file) => ({
        path: path.join(rootDir, layoutRoot, 'package.json'),
        scripts: Record.filter(file.scripts ?? {}, Predicate.isString),
        bins: Array.map(binTargetsOf(file.bin), (target) => path.posix.join(layoutRoot, target)),
        tools: pipe(
          TOOL_KEYS,
          Array.map((key) => [key, file[key]] as const),
          Array.filter(([, value]) => value !== undefined),
        ),
      })),
    );

export const readPackageJson = (manifest: string): Result.Result<PackageJson, FileError> =>
  pipe(
    readJsonFile(PackageJsonFile)(manifest),
    Result.map((file) => ({
      dependencies: namesOf(file.dependencies),
      devDependencies: namesOf(file.devDependencies),
      optionalDependencies: namesOf(file.optionalDependencies),
      peerDependencies: namesOf(file.peerDependencies),
      declarations: declarationsOf(file),
    })),
  );
