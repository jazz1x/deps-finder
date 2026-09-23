import { type Dirent, existsSync } from 'node:fs';
import path from 'node:path';
import { Array, Data, Match, Option, Result, Schema, pipe } from 'effect';
import ignore, { type Ignore } from 'ignore';
import type { FileError } from '../domain/errors.js';
import type { Gathered } from '../domain/types.js';
import {
  gatherAll,
  gatherOptional,
  readDirectory,
  readFile,
  readJsonFile,
  readStats,
} from './file-reader.js';

type WalkRules = {
  readonly always: ReadonlyArray<string>;
  readonly atLayoutRoots: ReadonlyArray<string>;
  readonly withoutGitignore: ReadonlyArray<string>;
  readonly isSource: (relativePath: string) => boolean;
};

// prefix: from the file's directory down to rootDir. base: from rootDir down to the file's directory.
type Gitignore = { readonly prefix: string; readonly base: string; readonly rules: Ignore };

// layoutRoot: rootDir or the nearest named package.json above, relative to rootDir.
type Walk = {
  readonly rootDir: string;
  readonly excluded: Ignore;
  readonly atLayoutRoot: Ignore;
  readonly layoutRoot: string;
  readonly isSource: (relativePath: string) => boolean;
};

type EntryKind = 'directory' | 'file' | 'unfollowed';

type Source = { readonly path: string; readonly layoutRoot: string };

type Walked = Data.TaggedEnum<{
  Source: Source;
  Package: { readonly path: string };
}>;

const Walked = Data.taggedEnum<Walked>();

const NOTHING: Gathered<never> = { found: [], skipped: [] };

const skippedOnly = (skipped: ReadonlyArray<FileError>): Gathered<never> => ({
  found: [],
  skipped,
});

const DependencySection = Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown));

const Manifest = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  dependencies: DependencySection,
  devDependencies: DependencySection,
  peerDependencies: DependencySection,
  optionalDependencies: DependencySection,
});

type Manifest = typeof Manifest.Type;

type Role = 'package' | 'layout-root' | 'folder';

const declaresDependencies = (manifest: Manifest): boolean =>
  Array.some(
    [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ],
    (section) => Array.isReadonlyArrayNonEmpty(Object.keys(section ?? {})),
  );

const roleOf = (manifest: Manifest): Role =>
  Match.value(manifest).pipe(
    Match.when(
      (m) => m.name === undefined,
      (): Role => 'folder',
    ),
    Match.when(declaresDependencies, (): Role => 'package'),
    Match.orElse((): Role => 'layout-root'),
  );

const rulesOf = (patterns: string | ReadonlyArray<string>): Ignore =>
  ignore({ ignorecase: false }).add(patterns);

const readGitignore = (file: string): Result.Result<Ignore, FileError> =>
  Result.map(readFile(file), rulesOf);

const readPresent = <A>(
  directory: string,
  entries: ReadonlyArray<Dirent>,
  name: string,
  read: (file: string) => Result.Result<A, FileError>,
): Gathered<A> => {
  const [skipped, found] = pipe(
    entries,
    Array.filter((entry) => !entry.isDirectory() && entry.name === name),
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
  return { ...read, found: Array.map(read.found, (rules) => ({ prefix: '', base: dir, rules })) };
};

// ignore matches a directory only when its path ends with a slash.
const isGitignored = (
  gitignores: ReadonlyArray<Gitignore>,
  relativePath: string,
  slash: '' | '/',
): boolean =>
  Array.reduce(gitignores, false, (ignored, { prefix, base, rules }) => {
    const verdict = rules.test(
      path.posix.join(prefix, path.posix.relative(base, relativePath)) + slash,
    );
    return verdict.ignored || (ignored && !verdict.unignored);
  });

const slashFor = (entry: Dirent): '' | '/' => (entry.isDirectory() ? '/' : '');

const kindOf = (file: string, entry: Dirent): Result.Result<EntryKind, FileError> =>
  Match.value(entry).pipe(
    Match.when(
      (e) => e.isDirectory(),
      () => Result.succeed<EntryKind>('directory'),
    ),
    Match.when(
      (e) => e.isSymbolicLink(),
      () =>
        Result.map(readStats(file), (stats): EntryKind => (stats.isFile() ? 'file' : 'unfollowed')),
    ),
    Match.when(
      (e) => e.isFile(),
      () => Result.succeed<EntryKind>('file'),
    ),
    Match.orElse(() => Result.succeed<EntryKind>('unfollowed')),
  );

const walkEntries = (
  walk: Walk,
  dir: string,
  gitignores: ReadonlyArray<Gitignore>,
  entries: ReadonlyArray<Dirent>,
): Gathered<Walked> =>
  pipe(
    entries,
    Array.map((entry) => ({ entry, relativePath: path.posix.join(dir, entry.name) })),
    Array.filter(
      ({ entry, relativePath }) =>
        (entry.isDirectory() || walk.isSource(relativePath)) &&
        !walk.excluded.ignores(relativePath + slashFor(entry)) &&
        !walk.atLayoutRoot.ignores(
          path.posix.relative(walk.layoutRoot, relativePath) + slashFor(entry),
        ) &&
        !isGitignored(gitignores, relativePath, slashFor(entry)),
    ),
    Array.map(({ entry, relativePath }) =>
      Result.match(kindOf(path.join(walk.rootDir, relativePath), entry), {
        onFailure: (error) => skippedOnly([error]),
        onSuccess: (kind) =>
          Match.value(kind).pipe(
            Match.when('directory', () => walkSubdirectory(walk, relativePath, gitignores)),
            Match.when('file', (): Gathered<Walked> => ({
              found: [Walked.Source({ path: relativePath, layoutRoot: walk.layoutRoot })],
              skipped: [],
            })),
            Match.when('unfollowed', () => NOTHING),
            Match.exhaustive,
          ),
      }),
    ),
    gatherAll,
  );

const walkFolder = (
  walk: Walk,
  dir: string,
  inherited: ReadonlyArray<Gitignore>,
  entries: ReadonlyArray<Dirent>,
): Gathered<Walked> => {
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
): Gathered<Walked> =>
  Result.match(readDirectory(path.join(walk.rootDir, dir)), {
    onFailure: (error) => skippedOnly([error]),
    onSuccess: (entries) => {
      const manifests = readPresent(
        path.join(walk.rootDir, dir),
        entries,
        'package.json',
        readJsonFile(Manifest),
      );
      const role = Option.match(Array.head(manifests.found), {
        onNone: (): Role => 'folder',
        onSome: roleOf,
      });
      return gatherAll([
        skippedOnly(manifests.skipped),
        Match.value(role).pipe(
          Match.when('package', (): Gathered<Walked> => ({
            found: [Walked.Package({ path: dir })],
            skipped: [],
          })),
          Match.when('layout-root', () =>
            walkFolder({ ...walk, layoutRoot: dir }, dir, inherited, entries),
          ),
          Match.when('folder', () => walkFolder(walk, dir, inherited, entries)),
          Match.exhaustive,
        ),
      ]);
    },
  });

const lineage = (dir: string): Array.NonEmptyReadonlyArray<string> =>
  path.dirname(dir) === dir ? [dir] : [dir, ...lineage(path.dirname(dir))];

type Inherited = {
  readonly exclude: Gathered<Gitignore>;
  readonly gitignores: Gathered<Gitignore>;
};

const readInherited = (rootDir: string, dir: string, file: string): Gathered<Gitignore> => {
  const read = gatherOptional(Result.map(readGitignore(file), Array.of));
  const prefix = path.relative(dir, rootDir);
  return { ...read, found: Array.map(read.found, (rules) => ({ prefix, base: '', rules })) };
};

const inheritedFrom = (rootDir: string, top: string, above: ReadonlyArray<string>): Inherited => {
  const exclude = readInherited(rootDir, top, path.join(top, '.git', 'info', 'exclude'));
  const gitignores = gatherAll(
    Array.map(above, (dir) => readInherited(rootDir, dir, path.join(dir, '.gitignore'))),
  );
  const rootIgnored =
    Array.isReadonlyArrayNonEmpty(above) &&
    isGitignored([...exclude.found, ...gitignores.found], '', '/');
  const kept = (read: Gathered<Gitignore>) => ({ ...read, found: rootIgnored ? [] : read.found });
  return { exclude: kept(exclude), gitignores: kept(gitignores) };
};

// Rules above rootDir count only inside its git repository, and never hide rootDir itself.
const inheritedGitignores = (rootDir: string): Inherited => {
  const dirs = lineage(rootDir);
  return pipe(
    Array.findFirstWithIndex(dirs, (dir) => existsSync(path.join(dir, '.git'))),
    Option.match({
      onNone: (): Inherited => ({ exclude: NOTHING, gitignores: NOTHING }),
      onSome: ([top, index]) =>
        inheritedFrom(rootDir, top, Array.reverse(dirs.slice(1, index + 1))),
    }),
  );
};

const walkRoot = (rootDir: string, rules: WalkRules): Gathered<Walked> => {
  const walk: Walk = {
    rootDir,
    excluded: rulesOf(rules.always),
    atLayoutRoot: rulesOf(rules.atLayoutRoots),
    layoutRoot: '',
    isSource: rules.isSource,
  };
  const inherited = inheritedGitignores(path.resolve(rootDir));
  return Result.match(readDirectory(rootDir), {
    onFailure: (error) => skippedOnly([error]),
    onSuccess: (entries) => {
      const own = gitignoresIn(walk, '', entries);
      const gitignores = Array.match([...inherited.gitignores.found, ...own.found], {
        onEmpty: (): ReadonlyArray<Gitignore> => [
          { prefix: '', base: '', rules: rulesOf(rules.withoutGitignore) },
        ],
        onNonEmpty: (found) => found,
      });
      return gatherAll([
        skippedOnly(inherited.exclude.skipped),
        skippedOnly(inherited.gitignores.skipped),
        skippedOnly(own.skipped),
        walkEntries(walk, '', [...inherited.exclude.found, ...gitignores], entries),
      ]);
    },
  });
};

export const walkProject = (
  rootDir: string,
  rules: WalkRules,
): Gathered<Source> & { readonly packages: ReadonlyArray<string> } => {
  const { found, skipped } = walkRoot(rootDir, rules);
  const [packages, sources] = Array.partition(
    found,
    Walked.$match({
      Source: (source) =>
        Result.succeed<Source>({ path: source.path, layoutRoot: source.layoutRoot }),
      Package: (nested) => Result.fail(nested.path),
    }),
  );
  return { found: sources, skipped, packages };
};
