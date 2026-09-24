import { Array, Option, Record, pipe } from 'effect';
import {
  type ImportDetails,
  Installation,
  type InstalledPackage,
  type PackageName,
  type ScriptCommand,
  developmentUse,
} from '../domain/types.js';
import { unscoped } from '../parsers/installed-packages.js';
import { invokedCommands } from '../parsers/script-parser.js';

const installedIn = (installation: Installation) => (name: PackageName) =>
  Installation.$match(installation, {
    Installed: ({ packages }) => Record.get(packages, name),
    NotInstalled: () => Option.none<InstalledPackage>(),
  });

// A package that is not installed is taken to name its binary after itself.
const binariesOf =
  (installation: Installation) =>
  (name: PackageName): ReadonlyArray<string> =>
    Option.match(installedIn(installation)(name), {
      onNone: () => Array.dedupe([name, unscoped(name)]),
      onSome: (installed) => installed.bins,
    });

export const binaryUses = (
  commands: ReadonlyArray<ScriptCommand>,
  installation: Installation,
  declared: ReadonlyArray<PackageName>,
): ReadonlyArray<ImportDetails> => {
  const providers = Array.flatMap(declared, (name) =>
    Array.map(binariesOf(installation)(name), (binary) => ({ binary, name })),
  );
  return Array.flatMap(commands, ({ file, script, scripts }) =>
    pipe(
      invokedCommands(script, scripts),
      Array.flatMap((command) => Array.filter(providers, ({ binary }) => binary === command)),
      Array.map(({ name, binary }) => developmentUse(name, file, binary)),
    ),
  );
};

type Satisfied = {
  readonly peer: PackageName;
  readonly by: PackageName;
  readonly manifest: string;
};

const satisfiedBy =
  (installation: Installation, declared: ReadonlyArray<PackageName>) =>
  (
    known: ReadonlyArray<PackageName>,
    frontier: ReadonlyArray<PackageName>,
  ): ReadonlyArray<Satisfied> => {
    const found = pipe(
      frontier,
      Array.flatMap((by) =>
        Option.match(installedIn(installation)(by), {
          onNone: (): ReadonlyArray<Satisfied> => [],
          onSome: ({ peers, manifest }) => Array.map(peers, (peer) => ({ peer, by, manifest })),
        }),
      ),
      Array.filter(({ peer }) => Array.contains(declared, peer) && !Array.contains(known, peer)),
      Array.dedupeWith((a, b) => a.peer === b.peer),
    );
    const peers = Array.map(found, ({ peer }) => peer);
    return Array.match(found, {
      onEmpty: () => [],
      onNonEmpty: () => [
        ...found,
        ...satisfiedBy(installation, declared)([...known, ...peers], peers),
      ],
    });
  };

// A declared package that a used package names as a peer, optional or not, is installed for it.
export const peerUses = (
  installation: Installation,
  declared: ReadonlyArray<PackageName>,
  uses: ReadonlyArray<ImportDetails>,
): ReadonlyArray<ImportDetails> => {
  const named = new Set(Array.map(uses, (use) => use.packageName));
  const used = Array.filter(declared, (name) => named.has(name));
  return Array.map(satisfiedBy(installation, declared)(used, used), ({ peer, by, manifest }) =>
    developmentUse(peer, manifest, `peerDependencies of ${by}`),
  );
};
