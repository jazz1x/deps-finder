import { existsSync } from 'node:fs';
import path from 'node:path';
import { Array, Match, Option, Record, Result, Schema, String, pipe } from 'effect';
import type { FileError } from '../domain/errors.js';
import {
  type Gathered,
  Installation,
  type InstalledPackage,
  type PackageName,
} from '../domain/types.js';
import { gatherAll, gatherOptional, lenientKey, readJsonFile } from '../utils/file-reader.js';
import { lineage } from '../utils/project-walk.js';

const InstalledManifest = Schema.Struct({
  name: lenientKey(Schema.String),
  bin: lenientKey(Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.String)])),
  peerDependencies: lenientKey(Schema.Record(Schema.String, Schema.Unknown)),
  peerDependenciesMeta: lenientKey(Schema.Record(Schema.String, Schema.Unknown)),
});

export const unscoped = (name: PackageName): string => Array.lastNonEmpty(String.split(name, '/'));

// A string "bin" is named after the package, less its scope.
const binsOf = (name: PackageName, bin: typeof InstalledManifest.Type.bin) =>
  Match.value(bin).pipe(
    Match.when(Match.undefined, (): ReadonlyArray<string> => []),
    Match.when(Match.string, () => [unscoped(name)]),
    Match.orElse((bins) => Record.keys(bins)),
  );

const installedPackage =
  (manifest: string, declared: PackageName) =>
  (file: typeof InstalledManifest.Type): InstalledPackage => ({
    manifest,
    bins: binsOf(file.name ?? declared, file.bin),
    peers: Array.dedupe([
      ...Record.keys(file.peerDependencies ?? {}),
      ...Record.keys(file.peerDependenciesMeta ?? {}),
    ]),
  });

type Located = readonly [PackageName, string];

// Node resolves a package from the nearest node_modules above the importing directory.
const locate =
  (nodeModules: ReadonlyArray<string>) =>
  (name: PackageName): Option.Option<Located> =>
    pipe(
      Array.findFirst(nodeModules, (dir) =>
        Option.liftPredicate(path.join(dir, name, 'package.json'), existsSync),
      ),
      Option.map((manifest) => [name, manifest] as const),
    );

const readInstalled = ([name, manifest]: Located): Gathered<
  readonly [PackageName, InstalledPackage]
> =>
  gatherOptional(
    Result.map(readJsonFile(InstalledManifest)(manifest), (file) => [
      [name, installedPackage(manifest, name)(file)] as const,
    ]),
  );

const PLUG_AND_PLAY_MAPS = ['.pnp.cjs', '.pnp.js'];

// Yarn Plug'n'Play installs without node_modules, into a store this does not read.
const absentFrom = (dirs: ReadonlyArray<string>): Installation =>
  Option.match(
    Array.findFirst(dirs, (dir) =>
      Array.some(PLUG_AND_PLAY_MAPS, (map) => existsSync(path.join(dir, map))),
    ),
    {
      onNone: () => Installation.NotInstalled(),
      onSome: () => Installation.PlugAndPlay(),
    },
  );

// A node_modules above that holds none of the declared packages belongs to something else.
// A manifest that does not parse is still an install. With nothing declared, nothing is missing.
const installationOf = (
  dirs: ReadonlyArray<string>,
  names: ReadonlyArray<PackageName>,
  located: ReadonlyArray<Located>,
  found: ReadonlyArray<readonly [PackageName, InstalledPackage]>,
): Installation =>
  Match.value({ names, located }).pipe(
    Match.when({ names: Array.isReadonlyArrayNonEmpty, located: Array.isReadonlyArrayEmpty }, () =>
      absentFrom(dirs),
    ),
    Match.orElse(() => Installation.Installed({ packages: Record.fromEntries(found) })),
  );

export const readInstallation = (
  rootDir: string,
  names: ReadonlyArray<PackageName>,
): { readonly installation: Installation; readonly skipped: ReadonlyArray<FileError> } => {
  const dirs = lineage(path.resolve(rootDir));
  const nodeModules = Array.map(dirs, (dir) => path.join(dir, 'node_modules'));
  const located = Array.getSomes(Array.map(names, locate(nodeModules)));
  const read = gatherAll(Array.map(located, readInstalled));
  return {
    installation: installationOf(dirs, names, located, read.found),
    skipped: read.skipped,
  };
};
