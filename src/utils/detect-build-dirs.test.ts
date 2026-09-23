import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { detectBuildDirectories, detectByHeuristic } from './detect-build-dirs';

describe('detect-build-dirs', () => {
  const testDir = './test-detect-dirs';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('detectBuildDirectories', () => {
    test('includes the tsconfig outDirs', () => {
      const detected = detectBuildDirectories(testDir, [{ compilerOptions: { outDir: 'custom-dist' } }]).found;
      expect(detected).toContain('custom-dist');
    });

    test('detects --outDir from package.json scripts', async () => {
      await writeFile(
        `${testDir}/package.json`,
        JSON.stringify({
          scripts: {
            build: 'tsc --outDir build-output',
          },
        }),
      );

      const detected = detectBuildDirectories(testDir, []).found;
      expect(detected).toContain('build-output');
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
