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
    test('detects outDir from tsconfig.json', async () => {
      await writeFile(
        `${testDir}/tsconfig.json`,
        JSON.stringify({
          compilerOptions: {
            outDir: 'custom-dist',
          },
        }),
      );

      const detected = detectBuildDirectories(testDir);
      expect(detected).toContain('custom-dist/**');
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

      const detected = detectBuildDirectories(testDir);
      expect(detected).toContain('build-output/**');
    });

    test('ignores an empty tsconfig outDir instead of excluding everything', async () => {
      await writeFile(`${testDir}/tsconfig.json`, JSON.stringify({ compilerOptions: { outDir: '' } }));
      expect(detectBuildDirectories(testDir)).toEqual([]);
    });

    test('handles missing files gracefully', async () => {
      const detected = detectBuildDirectories(testDir);
      expect(detected).toEqual([]);
    });

    test('handles invalid JSON gracefully', async () => {
      await writeFile(`${testDir}/tsconfig.json`, '{ invalid json }');
      const detected = detectBuildDirectories(testDir);
      expect(detected).toEqual([]);
    });
  });

  describe('detectByHeuristic', () => {
    test('detects directories with build-like suffixes', async () => {
      await mkdir(`${testDir}/storybook-static`);
      await mkdir(`${testDir}/my-app-dist`);
      await mkdir(`${testDir}/random-dir`);

      const detected = detectByHeuristic(testDir);
      expect(detected).toContain('storybook-static/**');
      expect(detected).toContain('my-app-dist/**');
      expect(detected).not.toContain('random-dir/**');
    });

    test('ignores files with build-like suffixes', async () => {
      await writeFile(`${testDir}/file-static`, 'content');
      const detected = detectByHeuristic(testDir);
      expect(detected).toEqual([]);
    });
  });
});
