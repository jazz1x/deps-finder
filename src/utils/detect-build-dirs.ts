import path from 'node:path';
import { Array, Option, Result, Schema, String, pipe } from 'effect';
import type { Gathered } from '../domain/types.js';
import { segmentsOf } from '../parsers/script-parser.js';
import { gatherOptional, readDirectory, readJsonFile, readRealPath } from './file-reader.js';
import { type TsConfigChain, outDirsOf } from './tsconfig-reader.js';

const PackageScripts = Schema.Struct({
  scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

const OUT_DIR_FLAGS = ['--outDir', '--out-dir', '--outdir'];

// Elsewhere -d is a flag of its own, such as tsup's --dts.
const SHORT_OUT_DIR_COMPILERS = ['babel', 'swc'];

const outDirFlagsOf = (words: ReadonlyArray<string>): ReadonlyArray<string> =>
  Option.match(
    Array.findFirst(words, (word) => Array.contains(SHORT_OUT_DIR_COMPILERS, path.basename(word))),
    { onNone: () => OUT_DIR_FLAGS, onSome: () => [...OUT_DIR_FLAGS, '-d'] },
  );

const outDirsIn = (words: ReadonlyArray<string>): ReadonlyArray<string> => {
  const flags = outDirFlagsOf(words);
  return pipe(
    words,
    Array.map((word, index) => {
      const [flag = '', ...inline] = String.split(word, '=');
      return pipe(
        Option.liftPredicate(flag, (name) => Array.contains(flags, name)),
        Option.map(() =>
          Array.match(inline, {
            onEmpty: () => words[index + 1] ?? '',
            onNonEmpty: (value) => value.join('='),
          }),
        ),
        Option.filter(String.isNonEmpty),
      );
    }),
    Array.getSomes,
  );
};

const outDirsFromScripts = (pkg: typeof PackageScripts.Type): ReadonlyArray<string> =>
  pipe(Object.values(pkg.scripts ?? {}), Array.flatMap(segmentsOf), Array.flatMap(outDirsIn));

// Through a symlink one directory has two spellings. A directory not built yet has no real path,
// and holds nothing to exclude whichever way it is spelt.
const realOrAsWritten = (dir: string): string =>
  Result.getOrElse(readRealPath(dir), () => path.resolve(dir));

// The project root or a directory outside it holds no build output of its own to exclude.
const insideRoot = (projectRoot: string) => {
  const root = realOrAsWritten(projectRoot);
  return (absolute: string): Option.Option<string> =>
    pipe(
      path.relative(root, realOrAsWritten(absolute)),
      Option.liftPredicate(
        (relative) =>
          relative !== '' &&
          relative !== '..' &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative),
      ),
      Option.map((relative) => relative.split(path.sep).join('/')),
    );
};

export const detectBuildDirectories = (
  projectRoot: string,
  tsconfigs: ReadonlyArray<TsConfigChain>,
): Gathered<string> => {
  const scripts = gatherOptional(
    Result.map(readJsonFile(PackageScripts)(path.join(projectRoot, 'package.json')), (pkg) =>
      Array.map(outDirsFromScripts(pkg), (dir) =>
        path.resolve(projectRoot, String.replaceAll('\\', '/')(dir)),
      ),
    ),
  );
  return {
    found: pipe(
      [...scripts.found, ...Array.flatMap(tsconfigs, outDirsOf)],
      Array.map(insideRoot(projectRoot)),
      Array.getSomes,
      Array.dedupe,
    ),
    skipped: scripts.skipped,
  };
};

const BUILD_LIKE_SUFFIXES = ['-static', '-dist', '-build', '-output'];

export const detectByHeuristic = (projectRoot: string): Gathered<string> =>
  gatherOptional(
    Result.map(readDirectory(projectRoot), (entries) =>
      pipe(
        entries,
        Array.filter((entry) => entry.isDirectory()),
        Array.map((entry) => entry.name),
        Array.filter((dir) => Array.some(BUILD_LIKE_SUFFIXES, (suffix) => dir.endsWith(suffix))),
      ),
    ),
  );
