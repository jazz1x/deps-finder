import { type Dirent, existsSync } from 'node:fs';
import path from 'node:path';
import { Array, Data, Match, Option, Result, Schema, String, pipe } from 'effect';
import ignore, { type Ignore } from 'ignore';
import { minimatch } from 'minimatch';
import type { FileError } from '../domain/errors.js';
import type { Gathered } from '../domain/types.js';
import {
  gatherAll,
  gatherOptional,
  readDirectory,
  readFile,
  readJsonFile,
  readStats,
  readYamlFile,
} from './file-reader.js';

type WalkRules = {
  readonly always: ReadonlyArray<string>;
  readonly atLayoutRoots: ReadonlyArray<string>;
  readonly withoutGitignore: ReadonlyArray<string>;
  readonly isSource: (relativePath: string) => boolean;
};

// prefix: from the file's directory down to rootDir. base: from rootDir down to the file's directory.
type Gitignore = { readonly prefix: string; readonly base: string; readonly rules: Ignore };

// layoutRoots: rootDir and every directory above with a named package.json or a project.json, relative to rootDir.
type Walk = {
  readonly rootDir: string;
  readonly excluded: Ignore;
  readonly atLayoutRoot: Ignore;
  readonly layoutRoots: Array.NonEmptyReadonlyArray<string>;
  readonly isSource: (relativePath: string) => boolean;
  readonly isWorkspaceMember: (dir: string) => boolean;
};

type EntryKind = 'directory' | 'file' | 'unfollowed';

type Source = {
  readonly path: string;
  readonly layoutRoots: Array.NonEmptyReadonlyArray<string>;
};

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

const Manifest = Schema.Struct({ name: Schema.optionalKey(Schema.String) });

const Globs = Schema.Array(Schema.String);

const RootManifest = Schema.Struct({
  workspaces: Schema.optionalKey(
    Schema.NullOr(Schema.Union([Globs, Schema.Struct({ packages: Globs })])),
  ),
});

const PnpmWorkspace = Schema.NullOr(
  Schema.Struct({ packages: Schema.optionalKey(Schema.NullOr(Globs)) }),
);

const INSTALL_MARKERS: ReadonlyArray<string> = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'node_modules',
];

type Role = 'package' | 'layout-root' | 'folder';

type Signals = { readonly separateInstall: boolean; readonly layoutRoot: boolean };

const roleOf = (signals: Signals): Role =>
  Match.value(signals).pipe(
    Match.when({ separateInstall: true }, (): Role => 'package'),
    Match.when({ layoutRoot: true }, (): Role => 'layout-root'),
    Match.orElse((): Role => 'folder'),
  );

type WorkspaceGlob = { readonly negated: boolean; readonly pattern: string };

const workspaceGlobOf = (glob: string): WorkspaceGlob => {
  const negated = String.startsWith('!')(glob);
  return {
    negated,
    pattern: String.replace(/^\.\//, '')(negated ? glob.slice(1) : glob),
  };
};

// npm and pnpm glob `${pattern}/package.json`, so `libs/**` also claims libs itself.
// A negation excludes wherever it sits in the list (npm 11, pnpm 11).
const isMemberOf = (globs: ReadonlyArray<WorkspaceGlob>) => {
  const negations = Array.filter(globs, ({ negated }) => negated);
  const positives = Array.filter(globs, ({ negated }) => !negated);
  return (dir: string): boolean => {
    const matches = ({ pattern }: WorkspaceGlob) =>
      minimatch(`${dir}/package.json`, `${pattern}/package.json`);
    return Array.some(positives, matches) && !Array.some(negations, matches);
  };
};

const workspacesOf = (manifest: typeof RootManifest.Type): ReadonlyArray<string> =>
  Match.value(manifest.workspaces).pipe(
    Match.whenOr(Match.undefined, Match.null, (): ReadonlyArray<string> => []),
    Match.when({ packages: Match.any }, (declared) => declared.packages),
    Match.orElse((globs) => globs),
  );

const pnpmPackagesOf = (workspace: typeof PnpmWorkspace.Type): ReadonlyArray<string> =>
  Match.value(workspace).pipe(
    Match.when(Match.null, (): ReadonlyArray<string> => []),
    Match.orElse((declared) => declared.packages ?? []),
  );

// Only the declaration is dropped; package.json itself is still read for dependencies.
const workspacesError = (error: FileError): FileError => ({
  ...error,
  path: `${error.path}#workspaces`,
});

const workspaceGlobsIn = (
  rootDir: string,
  entries: ReadonlyArray<Dirent>,
): Gathered<WorkspaceGlob> => {
  const npm = readPresent(rootDir, entries, 'package.json', readJsonFile(RootManifest));
  const pnpm = readPresent(rootDir, entries, 'pnpm-workspace.yaml', readYamlFile(PnpmWorkspace));
  return {
    found: Array.map(
      [...Array.flatMap(npm.found, workspacesOf), ...Array.flatMap(pnpm.found, pnpmPackagesOf)],
      workspaceGlobOf,
    ),
    skipped: [...Array.map(npm.skipped, workspacesError), ...pnpm.skipped],
  };
};

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
  rootDir: string,
  dir: string,
  entries: ReadonlyArray<Dirent>,
): Gathered<Gitignore> => {
  const read = readPresent(path.join(rootDir, dir), entries, '.gitignore', readGitignore);
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
        !Array.some(walk.layoutRoots, (root) =>
          walk.atLayoutRoot.ignores(path.posix.relative(root, relativePath) + slashFor(entry)),
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
              found: [Walked.Source({ path: relativePath, layoutRoots: walk.layoutRoots })],
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
  const own = gitignoresIn(walk.rootDir, dir, entries);
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
      const names = Array.map(entries, (entry) => entry.name);
      const role = roleOf({
        separateInstall:
          Array.contains(names, 'package.json') &&
          (walk.isWorkspaceMember(dir) ||
            Array.some(INSTALL_MARKERS, (marker) => Array.contains(names, marker))),
        layoutRoot:
          Array.some(manifests.found, (manifest) => manifest.name !== undefined) ||
          Array.contains(names, 'project.json'),
      });
      return gatherAll([
        skippedOnly(manifests.skipped),
        Match.value(role).pipe(
          Match.when('package', (): Gathered<Walked> => ({
            found: [Walked.Package({ path: dir })],
            skipped: [],
          })),
          Match.when('layout-root', () =>
            walkFolder(
              { ...walk, layoutRoots: Array.append(walk.layoutRoots, dir) },
              dir,
              inherited,
              entries,
            ),
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
  const inherited = inheritedGitignores(path.resolve(rootDir));
  return Result.match(readDirectory(rootDir), {
    onFailure: (error) => skippedOnly([error]),
    onSuccess: (entries) => {
      const own = gitignoresIn(rootDir, '', entries);
      const gitignores = [...inherited.gitignores.found, ...own.found];
      const workspaces = workspaceGlobsIn(rootDir, entries);
      const walk: Walk = {
        rootDir,
        excluded: rulesOf(rules.always),
        atLayoutRoot: rulesOf(
          Array.match(gitignores, {
            onEmpty: () => [...rules.atLayoutRoots, ...rules.withoutGitignore],
            onNonEmpty: () => rules.atLayoutRoots,
          }),
        ),
        layoutRoots: [''],
        isSource: rules.isSource,
        isWorkspaceMember: isMemberOf(workspaces.found),
      };
      return gatherAll([
        skippedOnly(inherited.exclude.skipped),
        skippedOnly(inherited.gitignores.skipped),
        skippedOnly(own.skipped),
        skippedOnly(workspaces.skipped),
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
        Result.succeed<Source>({ path: source.path, layoutRoots: source.layoutRoots }),
      Package: (nested) => Result.fail(nested.path),
    }),
  );
  return { found: sources, skipped, packages };
};
