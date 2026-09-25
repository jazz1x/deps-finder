import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { detectBuildDirectories, detectByHeuristic } from './detect-build-dirs';
import { readRootTsConfigs } from './tsconfig-reader';

describe('detect-build-dirs', () => {
  const testDir = './test-detect-dirs';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const detect = () => detectBuildDirectories(testDir, readRootTsConfigs(testDir).found).found;

  const scripts = (build: string) => writeFile(`${testDir}/package.json`, JSON.stringify({ scripts: { build } }));

  const tsconfig = (compilerOptions: object) => writeFile(`${testDir}/tsconfig.json`, JSON.stringify({ compilerOptions }));

  describe('detectBuildDirectories', () => {
    test('includes the tsconfig outDirs', async () => {
      await tsconfig({ outDir: 'custom-dist' });
      expect(detect()).toEqual(['custom-dist']);
    });

    test('detects --outDir from package.json scripts', async () => {
      await scripts('tsc --outDir build-output');
      expect(detect()).toEqual(['build-output']);
    });

    test.each([
      'tsc --outDir=lib',
      'tsc --outDir "lib"',
      'tsup src --out-dir lib',
      'esbuild src/index.ts --outdir=lib',
      'babel src -d lib',
      'npx swc src -d lib/',
    ])('reads the output directory of %s', async (build) => {
      await scripts(build);
      expect(detect()).toEqual(['lib']);
    });

    test('-d names an output directory only for babel and swc', async () => {
      await scripts('node tools/gen.js -d lib');
      expect(detect()).toEqual([]);
    });

    test.each(['./lib', 'lib/', '.\\lib'])('normalises the outDir %s', async (outDir) => {
      await tsconfig({ outDir });
      expect(detect()).toEqual(['lib']);
    });

    test('takes an absolute outDir inside the project', async () => {
      await scripts(`tsc --outDir ${path.resolve(testDir, 'lib')}`);
      expect(detect()).toEqual(['lib']);
    });

    test('takes an absolute outDir inside the project reached through a symlink', async () => {
      const linked = `${testDir}-link`;
      await symlink(path.resolve(testDir), linked);
      await tsconfig({ outDir: path.join(realpathSync(testDir), 'lib') });
      const found = detectBuildDirectories(linked, readRootTsConfigs(linked).found).found;
      await rm(linked);
      expect(found).toEqual(['lib']);
    });

    test.each(['.', './', '..', '../elsewhere'])('an outDir of %s excludes nothing', async (outDir) => {
      await tsconfig({ outDir });
      expect(detect()).toEqual([]);
    });

    test('an inherited outDir resolves from the tsconfig that declares it', async () => {
      await mkdir(`${testDir}/config`);
      await writeFile(`${testDir}/config/base.json`, '{ "compilerOptions": { "outDir": "../lib" } }');
      await writeFile(`${testDir}/tsconfig.json`, '{ "extends": "./config/base.json" }');
      expect(detect()).toEqual(['lib']);
    });

    test('${configDir} is the directory of the extending tsconfig', async () => {
      await mkdir(`${testDir}/config`);
      await writeFile(`${testDir}/config/base.json`, '{ "compilerOptions": { "outDir": "${configDir}/lib" } }');
      await writeFile(`${testDir}/tsconfig.json`, '{ "extends": "./config/base.json" }');
      expect(detect()).toEqual(['lib']);
    });

    test('reads every root tsconfig, such as the one a build script passes to -p', async () => {
      await writeFile(`${testDir}/tsconfig.build.json`, '{ "compilerOptions": { "outDir": "lib" } }');
      expect(detect()).toEqual(['lib']);
    });

    test('missing files are not a problem', async () => {
      expect(detectBuildDirectories(testDir, [])).toEqual({ found: [], skipped: [] });
    });
  });

  describe('detectByHeuristic', () => {
    test('detects directories with build-like suffixes', async () => {
      await mkdir(`${testDir}/storybook-static`);
      await mkdir(`${testDir}/my-app-dist`);
      await mkdir(`${testDir}/random-dir`);

      const detected = detectByHeuristic(testDir).found;
      expect(detected).toContain('storybook-static');
      expect(detected).toContain('my-app-dist');
      expect(detected).not.toContain('random-dir');
    });

    test('ignores files with build-like suffixes', async () => {
      await writeFile(`${testDir}/file-static`, 'content');
      const detected = detectByHeuristic(testDir).found;
      expect(detected).toEqual([]);
    });
  });
});
