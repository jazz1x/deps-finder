import { join } from 'node:path';
import { Array, Match, Option, Result, Schema, String, pipe } from 'effect';
import { readFile, readJsonFile } from './file-reader.js';

const Globs = Schema.Array(Schema.String);

const PackageWorkspaces = Schema.Struct({
  workspaces: Schema.optionalKey(
    Schema.Union([Globs, Schema.Struct({ packages: Schema.optionalKey(Globs) })]),
  ),
});

const fromPackageJson = (rootDir: string): ReadonlyArray<string> =>
  pipe(
    readJsonFile(PackageWorkspaces)(join(rootDir, 'package.json')),
    Result.map(({ workspaces }) =>
      Match.value(workspaces).pipe(
        Match.when(Match.undefined, (): ReadonlyArray<string> => []),
        Match.when(Schema.is(Globs), (globs) => globs),
        Match.orElse(({ packages }) => packages ?? []),
      ),
    ),
    Result.getOrElse((): ReadonlyArray<string> => []),
  );

const PACKAGES_KEY = /^packages:\s*$/;
const LIST_BODY = /^(\s+-.*|\s*(#.*)?)$/;
const LIST_ITEM = /^\s+-\s+['"]?([^'"#\s]+)/;

const fromPnpmWorkspace = (rootDir: string): ReadonlyArray<string> =>
  pipe(
    readFile(join(rootDir, 'pnpm-workspace.yaml')),
    Result.map((yaml) =>
      pipe(
        String.split(yaml, /\r?\n/),
        Array.dropWhile((line) => !PACKAGES_KEY.test(line)),
        Array.drop(1),
        Array.takeWhile((line) => LIST_BODY.test(line)),
        Array.map((line) => Option.fromNullishOr(LIST_ITEM.exec(line)?.[1])),
        Array.getSomes,
      ),
    ),
    Result.getOrElse((): ReadonlyArray<string> => []),
  );

export const readWorkspacePatterns = (rootDir: string): ReadonlyArray<string> => [
  ...fromPackageJson(rootDir),
  ...fromPnpmWorkspace(rootDir),
];
