import type { Dirent } from 'node:fs';
import path from 'node:path';
import { Array, Match, Option, Result, Schema, pipe } from 'effect';
import ignore, { type Ignore } from 'ignore';
import type { FileError } from '../domain/errors.js';
import type { Gathered } from '../domain/types.js';
import { gatherAll, readDirectory, readFile, readJsonFile } from './file-reader.js';

export type WalkRules = {
  readonly always: ReadonlyArray<string>;
  readonly withoutGitignore: ReadonlyArray<string>;
};

type Gitignore = { readonly base: string; readonly rules: Ignore };

type Walk = {
  readonly rootDir: string;
  readonly excluded: Ignore;
};

const NOTHING: Gathered<never> = { found: [], skipped: [] };

const skippedOnly = (skipped: ReadonlyArray<FileError>): Gathered<never> => ({
  found: [],
  skipped,
});

const Manifest = Schema.Struct({ name: Schema.optionalKey(Schema.String) });

const readGitignore = (file: string): Result.Result<Ignore, FileError> =>
  Result.map(readFile(file), (content) => ignore().add(content));

const readPresent = <A>(
  directory: string,
  entries: ReadonlyArray<Dirent>,
  name: string,
  read: (file: string) => Result.Result<A, FileError>,
): Gathered<A> => {
  const [skipped, found] = pipe(
    entries,
    Array.filter((entry) => entry.isFile() && entry.name === name),
    Array.map((entry) => path.join(directory, entry.name)),
    Array.partition(read),
  );
  return { found, skipped };
};

const gitignoresIn = (
  walk: Walk,
  dir: string,
  entries: ReadonlyArray<Dirent>,
): Gathered<Gitignore> => {
  const read = readPresent(path.join(walk.rootDir, dir), entries, '.gitignore', readGitignore);
  return { ...read, found: Array.map(read.found, (rules) => ({ base: dir, rules })) };
};

type Candidate = { readonly entry: Dirent; readonly relativePath: string };

// ignore matches a directory only when its path ends with a slash.
const pathFrom =
  (base: string) =>
  ({ entry, relativePath }: Candidate): string =>
    path.posix.relative(base, relativePath) + (entry.isDirectory() ? '/' : '');

const isGitignored = (gitignores: ReadonlyArray<Gitignore>, candidate: Candidate): boolean =>
  Array.reduce(gitignores, false, (ignored, { base, rules }) => {
    const verdict = rules.test(pathFrom(base)(candidate));
    return verdict.ignored || (ignored && !verdict.unignored);
  });

const walkEntries = (
  walk: Walk,
  dir: string,
  gitignores: ReadonlyArray<Gitignore>,
  entries: ReadonlyArray<Dirent>,
): Gathered<string> =>
  pipe(
    entries,
    Array.map((entry): Candidate => ({ entry, relativePath: path.posix.join(dir, entry.name) })),
    Array.filter(
      (candidate) =>
        !walk.excluded.ignores(pathFrom('')(candidate)) && !isGitignored(gitignores, candidate),
    ),
    Array.map(({ entry, relativePath }) =>
      Match.value(entry).pipe(
        Match.when(
          (e) => e.isDirectory(),
          () => walkSubdirectory(walk, relativePath, gitignores),
        ),
        Match.when(
          (e) => e.isFile(),
          (): Gathered<string> => ({ found: [relativePath], skipped: [] }),
        ),
        Match.orElse(() => NOTHING),
      ),
    ),
    gatherAll,
  );

const walkFolder = (
  walk: Walk,
  dir: string,
  inherited: ReadonlyArray<Gitignore>,
  entries: ReadonlyArray<Dirent>,
): Gathered<string> => {
  const own = gitignoresIn(walk, dir, entries);
  return gatherAll([
    skippedOnly(own.skipped),
    walkEntries(walk, dir, [...inherited, ...own.found], entries),
  ]);
};

const walkSubdirectory = (
  walk: Walk,
  dir: string,
  inherited: ReadonlyArray<Gitignore>,
): Gathered<string> =>
  Result.match(readDirectory(path.join(walk.rootDir, dir)), {
    onFailure: (error) => skippedOnly([error]),
    onSuccess: (entries) => {
      const manifests = readPresent(
        path.join(walk.rootDir, dir),
        entries,
        'package.json',
        readJsonFile(Manifest),
      );
      return gatherAll([
        skippedOnly(manifests.skipped),
        Array.match(
          Array.getSomes(Array.map(manifests.found, (m) => Option.fromNullishOr(m.name))),
          {
            onEmpty: () => walkFolder(walk, dir, inherited, entries),
            onNonEmpty: () => NOTHING,
          },
        ),
      ]);
    },
  });

export const walkProject = (rootDir: string, rules: WalkRules): Gathered<string> => {
  const walk: Walk = { rootDir, excluded: ignore().add([...rules.always]) };
  return Result.match(readDirectory(rootDir), {
    onFailure: (error) => skippedOnly([error]),
    onSuccess: (entries) => {
      const own = gitignoresIn(walk, '', entries);
      const gitignores = Array.match(own.found, {
        onEmpty: (): ReadonlyArray<Gitignore> => [
          { base: '', rules: ignore().add([...rules.withoutGitignore]) },
        ],
        onNonEmpty: (found) => found,
      });
      return gatherAll([skippedOnly(own.skipped), walkEntries(walk, '', gitignores, entries)]);
    },
  });
};
