import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { A, O, R, pipe } from '@mobily/ts-belt';
import { readJSONFile } from './file-reader.js';
import { readTsConfig } from './tsconfig-reader.js';

type RawPackageJson = {
  scripts?: Record<string, string>;
};

const extractOutDirFromScripts = (pkg: RawPackageJson): ReadonlyArray<string> => {
  return pipe(
    pkg.scripts || {},
    Object.values,
    A.filterMap((script) => {
      const outDirMatch = script.match(/--outDir\s+([^\s]+)/);
      return outDirMatch ? O.Some(`${outDirMatch[1]}/**`) : O.None;
    }),
  );
};

/**
 * 프로젝트 루트에서 빌드 출력으로 보이는 디렉토리 감지
 */
export const detectBuildDirectories = (projectRoot: string): ReadonlyArray<string> => {
  const pkgPath = join(projectRoot, 'package.json');
  const pkgResult = readJSONFile<RawPackageJson>(pkgPath);
  const tsconfigResult = readTsConfig(projectRoot);

  const fromPkg = pipe(
    pkgResult,
    R.map(extractOutDirFromScripts),
    R.getWithDefault([] as ReadonlyArray<string>),
  );

  const fromTsConfig = pipe(
    tsconfigResult,
    R.map((cfg) => (cfg.compilerOptions?.outDir ? [`${cfg.compilerOptions.outDir}/**`] : [])),
    R.getWithDefault([] as ReadonlyArray<string>),
  );

  return A.uniq([...fromPkg, ...fromTsConfig]);
};

/**
 * 디렉토리 이름 휴리스틱으로 빌드 출력 감지
 */
export const detectByHeuristic = (projectRoot: string): ReadonlyArray<string> => {
  const buildLikeSuffixes = ['-static', '-dist', '-build', '-output'];

  return pipe(
    R.fromExecution(() => readdirSync(projectRoot)),
    R.map((dirs): ReadonlyArray<string> =>
      pipe(
        dirs,
        A.filter((dir) => {
          const fullPath = join(projectRoot, dir);
          return pipe(
            R.fromExecution(() => statSync(fullPath).isDirectory()),
            R.getWithDefault(false),
          );
        }),
        A.filter((dir) => A.some(buildLikeSuffixes, (suffix) => dir.endsWith(suffix))),
        A.map((dir) => `${dir}/**`),
      ),
    ),
    R.getWithDefault([] as ReadonlyArray<string>),
  );
};
