import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { Result } from 'effect';
import { FileError } from '@/domain/errors';
import { readLayoutManifest, readPackageJson } from '@/parsers/package-parser';

describe('package-parser', () => {
  describe('readPackageJson', () => {
    const testDir = './test-read-pkg';
    const testFile = `${testDir}/package.json`;

    beforeEach(async () => {
      await mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(testDir, { recursive: true, force: true });
    });

    test('should read valid package.json', async () => {
      const packageData = {
        name: 'test-package',
        version: '1.0.0',
        dependencies: {
          react: '^18.0.0',
        },
        devDependencies: {
          typescript: '^5.0.0',
        },
      };

      await writeFile(testFile, JSON.stringify(packageData));

      const result = readPackageJson(testFile);
      expect(Result.isSuccess(result)).toBe(true);

      const pkg = Result.getOrThrow(result);
      expect(pkg.dependencies).toEqual(['react']);
      expect(pkg.devDependencies).toEqual(['typescript']);
    });

    test('should handle package.json with missing optional fields', async () => {
      const packageData = {
        name: 'test-package',
      };

      await writeFile(testFile, JSON.stringify(packageData));

      const result = readPackageJson(testFile);
      expect(Result.isSuccess(result)).toBe(true);

      const pkg = Result.getOrThrow(result);
      expect(pkg.dependencies).toEqual([]);
      expect(pkg.devDependencies).toEqual([]);
      expect(pkg.peerDependencies).toEqual([]);
    });

    test.each([
      [{ name: 'app' }, 'none'],
      [{ types: 'dist/index.d.ts' }, 'published'],
      [{ typings: 'index.d.ts' }, 'published'],
      [{ exports: { '.': { import: { types: './dist/index.d.mts', default: './dist/index.mjs' } } } }, 'published'],
      [{ exports: { '.': './dist/index.js' } }, 'none'],
    ] as const)('%j publishes declarations: %s', async (manifest, declarations) => {
      await writeFile(testFile, JSON.stringify(manifest));
      expect(Result.getOrThrow(readPackageJson(testFile)).declarations).toBe(declarations);
    });

    test('should return error for non-existent file', () => {
      const result = readPackageJson('./non-existent/package.json');
      expect(Result.isFailure(result)).toBe(true);
    });

    test('should return error for invalid JSON', async () => {
      await writeFile(testFile, 'invalid json content');

      const result = readPackageJson(testFile);
      expect(Result.isFailure(result)).toBe(true);
    });

    test('should handle package.json with all fields present', async () => {
      const packageData = {
        name: 'full-package',
        version: '2.0.0',
        dependencies: { lodash: '^4.0.0' },
        devDependencies: { jest: '^29.0.0' },
        peerDependencies: { react: '^18.0.0' },
      };

      await writeFile(testFile, JSON.stringify(packageData));

      const result = readPackageJson(testFile);
      expect(Result.isSuccess(result)).toBe(true);

      const pkg = Result.getOrThrow(result);
      expect(pkg.dependencies).toEqual(['lodash']);
      expect(pkg.devDependencies).toEqual(['jest']);
      expect(pkg.peerDependencies).toEqual(['react']);
    });

    test('should handle package.json with null values', async () => {
      const packageData = {
        name: 'test-package',
        version: null,
        dependencies: null,
      };

      await writeFile(testFile, JSON.stringify(packageData));

      const result = readPackageJson(testFile);
      expect(Result.isSuccess(result)).toBe(true);

      const pkg = Result.getOrThrow(result);
      expect(pkg.dependencies).toEqual([]);
    });

    test('should keep scoped dependency names', async () => {
      await writeFile(testFile, JSON.stringify({ dependencies: { '@myorg/my-package': '^1.0.0' } }));

      const result = readPackageJson(testFile);
      expect(Result.getOrThrow(result).dependencies).toEqual(['@myorg/my-package']);
    });

    test('should return error message for non-existent file', () => {
      const result = readPackageJson('./non-existent/package.json');
      expect(Result.isFailure(result)).toBe(true);
    });

    test('should return error message for invalid JSON', async () => {
      await writeFile(testFile, '{ invalid json }');

      const result = readPackageJson(testFile);
      expect(Result.isFailure(result)).toBe(true);
    });
  });

  describe('readPackageJson defensive parsing', () => {
    const testDir = './test-pkg-defensive';
    const testFile = `${testDir}/package.json`;

    beforeEach(async () => {
      await mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(testDir, { recursive: true, force: true });
    });

    test('returns Ok with all-empty when content is an empty object', async () => {
      await writeFile(testFile, '{}');
      const result = readPackageJson(testFile);
      expect(Result.isSuccess(result)).toBe(true);

      const pkg = Result.getOrThrow(result);
      expect(pkg.dependencies).toEqual([]);
    });

    test('returns ParseFailed for empty file (JSON.parse fails)', async () => {
      await writeFile(testFile, '');
      const result = readPackageJson(testFile);
      expect(Result.isFailure(result)).toBe(true);
      Result.match(result, {
        onSuccess: () => {
          throw new Error('Should not be Ok');
        },
        onFailure: (err) => {
          expect(FileError.$is('ParseFailed')(err)).toBe(true);
        },
      });
    });

    test('rejects array as top-level JSON with ParseFailed (not a plain object)', async () => {
      await writeFile(testFile, '[1, 2, 3]');
      const result = readPackageJson(testFile);
      expect(Result.isFailure(result)).toBe(true);
      Result.match(result, {
        onSuccess: () => {
          throw new Error('Should not be Ok');
        },
        onFailure: (err) => {
          expect(FileError.$is('ParseFailed')(err)).toBe(true);
        },
      });
    });

    test('rejects null as top-level JSON with ParseFailed', async () => {
      await writeFile(testFile, 'null');
      const result = readPackageJson(testFile);
      expect(Result.isFailure(result)).toBe(true);
    });

    test('rejects primitive top-level JSON with ParseFailed', async () => {
      await writeFile(testFile, '"just a string"');
      const result = readPackageJson(testFile);
      expect(Result.isFailure(result)).toBe(true);
    });

    test.each([['"lodash"'], ['["lodash"]'], ['5']])('rejects a non-object dependencies section (%s)', async (section) => {
      await writeFile(testFile, `{"dependencies":${section}}`);
      const result = readPackageJson(testFile);
      expect(
        Result.match(result, {
          onSuccess: () => '',
          onFailure: FileError.$match({
            ParseFailed: (e) => e.reason,
            FileNotFound: () => '',
            ReadFailed: () => '',
          }),
        }),
      ).toContain('dependencies');
    });

    test('stays strict JSON (comments are rejected, unlike tsconfig)', async () => {
      await writeFile(testFile, '{\n  // note\n  "dependencies": {}\n}');
      expect(Result.isFailure(readPackageJson(testFile))).toBe(true);
    });

    test('accepts a UTF-8 byte order mark, as npm does', async () => {
      await writeFile(testFile, `${String.fromCharCode(0xfeff)}{"dependencies":{"lodash":"^4.0.0"}}`);
      expect(Result.getOrThrow(readPackageJson(testFile)).dependencies).toEqual(['lodash']);
    });

    test('returns ParseFailed for json with trailing garbage', async () => {
      await writeFile(testFile, '{"name":"x"}garbage');
      const result = readPackageJson(testFile);
      expect(Result.isFailure(result)).toBe(true);
    });
  });

  describe('readLayoutManifest', () => {
    const testDir = './test-layout-manifest';

    beforeEach(async () => {
      await mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(testDir, { recursive: true, force: true });
    });

    test('drops a malformed "imports" entry alone', async () => {
      await writeFile(`${testDir}/package.json`, '{"imports":{"#q":5,"#r":"q1","#s":{"node":["q2"]}}}');
      expect(Result.getOrThrow(readLayoutManifest(testDir)('.')).subpathImports).toEqual([
        { key: '#r', targets: ['q1'] },
        { key: '#s', targets: ['q2'] },
      ]);
    });
  });
});
