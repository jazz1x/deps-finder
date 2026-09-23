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

// layoutRoots: rootDir and every directory above with a named package.json or an Nx project.json, relative to rootDir.
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

const INSTALL_MARKERS = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'node_modules',
] as const;

const isNxProject = (json: unknown): boolean =>
  Match.value(json).pipe(
    Match.when({ name: Match.string }, () => true),
    Match.when({ targets: Match.defined }, () => true),
    Match.when({ $schema: Match.defined }, () => true),
    Match.orElse(() => false),
  );

type Role = 'package' | 'layout-root' | 'folder';

type Signals = { readonly separateInstall: boolean; readonly layoutRoot: boolean };

const roleOf = (signals: Signals): Role =>
  Match.value(signals).pipe(
    Match.when({ separateInstall: true }, (): Role => 'package'),
    Match.when({ layoutRoot: true }, (): Role => 'layout-root'),
    Match.orElse((): Role => 'folder'),
  );

type WorkspaceGlob = { readonly negated: boolean; readonly pattern: string };

type Membership = {
  readonly positives: ReadonlyArray<string>;
  readonly negations: ReadonlyArray<string>;
};

const npmGlobOf = (glob: string): WorkspaceGlob => {
  const unbanged = String.replace(/^!+/, '')(glob);
  return {
    negated: (glob.length - unbanged.length) % 2 === 1,
    pattern: String.replace(/^\.?\/+/, '')(unbanged),
  };
};

const pnpmGlobOf = (glob: string): WorkspaceGlob => {
  const negated = String.startsWith('!')(glob);
  return {
    negated,
    pattern: String.replace(/^\.\//, '')(negated ? glob.slice(1) : glob),
  };
};

// @npmcli/map-workspaces: a positive cancels the earlier negations its own pattern matches.
const npmMembership = (globs: ReadonlyArray<string>): Membership =>
  Array.reduce(
    Array.map(globs, npmGlobOf),
    { positives: [], negations: [] },
    ({ positives, negations }: Membership, glob): Membership =>
      Match.value(glob).pipe(
        Match.when({ negated: true }, ({ pattern }) => ({
          positives,
          negations: [...negations, pattern],
        })),
        Match.orElse(({ pattern }) => ({
          positives: [...positives, pattern],
          negations: Array.filter(negations, (negation) => !minimatch(pattern, negation)),
        })),
      ),
  );

// pnpm hands its negations to the glob's ignore list, so they win wherever they sit.
const pnpmMembership = (globs: ReadonlyArray<string>): Membership => {
  const [positives, negations] = Array.partition(
    Array.map(globs, pnpmGlobOf),
    ({ negated, pattern }) => (negated ? Result.succeed(pattern) : Result.fail(pattern)),
  );
  return { positives, negations };
};

// Both tools glob `${pattern}/package.json`, so `libs/**` also claims libs itself.
const isMemberOf =
  (memberships: ReadonlyArray<Membership>) =>
  (dir: string): boolean => {
    const claims = (pattern: string) => minimatch(`${dir}/package.json`, `${pattern}/package.json`);
    return Array.some(
      memberships,
      ({ positives, negations }) => Array.some(positives, claims) && !Array.some(negations, claims),
    );
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

const membershipsIn = (rootDir: string, entries: ReadonlyArray<Dirent>): Gathered<Membership> => {
  const npm = readPresent(rootDir, entries, 'package.json', readJsonFile(RootManifest));
  const pnpm = readPresent(rootDir, entries, 'pnpm-workspace.yaml', readYamlFile(PnpmWorkspace));
  return {
    found: [
      ...Array.map(npm.found, (manifest) => npmMembership(workspacesOf(manifest))),
      ...Array.map(pnpm.found, (workspace) => pnpmMembership(pnpmPackagesOf(workspace))),
    ],
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
      const projects = readPresent(
        path.join(walk.rootDir, dir),
        entries,
        'project.json',
        readJsonFile(Schema.Unknown),
      );
      const names = Array.map(entries, (entry) => entry.name);
      const role = roleOf({
        separateInstall:
          Array.contains(names, 'package.json') &&
          (walk.isWorkspaceMember(dir) ||
            Array.some(INSTALL_MARKERS, (marker) => Array.contains(names, marker))),
        layoutRoot:
          Array.some(manifests.found, (manifest) => manifest.name !== undefined) ||
          Array.some(projects.found, isNxProject),
      });
      return gatherAll([
        skippedOnly(manifests.skipped),
        skippedOnly(projects.skipped),
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
      const workspaces = membershipsIn(rootDir, entries);
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
