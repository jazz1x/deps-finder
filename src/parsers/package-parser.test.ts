import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { O, R } from '@mobily/ts-belt';
import type { PackageJson } from '@/domain/types';
import { extractAllDependencies, extractDependencies, extractProductionDependencies, readPackageJson } from '@/parsers/package-parser';

describe('package-parser', () => {
  const mockPackageJson: PackageJson = {
    name: O.Some('test-package'),
    version: O.Some('1.0.0'),
    dependencies: O.Some({
      react: '^18.0.0',
      'ts-pattern': '^5.0.0',
    }),
    devDependencies: O.Some({
      '@types/node': '^20.0.0',
      typescript: '^5.0.0',
    }),
    peerDependencies: O.Some({
      'react-dom': '^18.0.0',
    }),
  };

  describe('extractAllDependencies', () => {
    test('should return all unique dependencies', () => {
      const result = extractAllDependencies(mockPackageJson);
      expect(result).toContain('react');
      expect(result).toContain('ts-pattern');
      expect(result).toContain('@types/node');
      expect(result).toContain('typescript');
      expect(result).toContain('react-dom');
      expect(result.length).toBe(5);
      expect(Array.isArray(result)).toBe(true);
      expect(new Set(result).size).toBe(result.length); // verify uniqueness
    });

    test('should return empty array for empty package.json', () => {
      const result = extractAllDependencies({
        name: O.None,
        version: O.None,
        dependencies: O.None,
        devDependencies: O.None,
        peerDependencies: O.None,
      });
      expect(result).toEqual([]);
      expect(result.length).toBe(0);
      expect(Array.isArray(result)).toBe(true);
    });

    test('should handle package with only dependencies', () => {
      const pkg: PackageJson = {
        name: O.Some('test'),
        version: O.Some('1.0.0'),
        dependencies: O.Some({ lodash: '^4.0.0', express: '^4.0.0' }),
        devDependencies: O.None,
        peerDependencies: O.None,
      };
      const result = extractAllDependencies(pkg);
      expect(result).toContain('lodash');
      expect(result).toContain('express');
      expect(result.length).toBe(2);
    });

    test('should handle package with only devDependencies', () => {
      const pkg: PackageJson = {
        name: O.Some('test'),
        version: O.Some('1.0.0'),
        dependencies: O.None,
        devDependencies: O.Some({ jest: '^29.0.0', vitest: '^1.0.0' }),
        peerDependencies: O.None,
      };
      const result = extractAllDependencies(pkg);
      expect(result).toContain('jest');
      expect(result).toContain('vitest');
      expect(result.length).toBe(2);
    });

    test('should handle package with only peerDependencies', () => {
      const pkg: PackageJson = {
        name: O.Some('test'),
        version: O.Some('1.0.0'),
        dependencies: O.None,
        devDependencies: O.None,
        peerDependencies: O.Some({ react: '^18.0.0' }),
      };
      const result = extractAllDependencies(pkg);
      expect(result).toContain('react');
      expect(result.length).toBe(1);
    });

    test('should deduplicate dependencies across different types', () => {
      const pkg: PackageJson = {
        name: O.Some('test'),
        version: O.Some('1.0.0'),
        dependencies: O.Some({ react: '^18.0.0' }),
        devDependencies: O.Some({ react: '^18.0.0' }),
        peerDependencies: O.Some({ react: '^18.0.0' }),
      };
      const result = extractAllDependencies(pkg);
      expect(result).toContain('react');
      expect(result.length).toBe(1);
      expect(result.filter((dep) => dep === 'react').length).toBe(1);
    });

    test('should handle scoped packages', () => {
      const pkg: PackageJson = {
        name: O.Some('test'),
        version: O.Some('1.0.0'),
        dependencies: O.Some({ '@mobily/ts-belt': '^4.0.0', '@types/node': '^20.0.0' }),
        devDependencies: O.None,
        peerDependencies: O.None,
      };
      const result = extractAllDependencies(pkg);
      expect(result).toContain('@mobily/ts-belt');
      expect(result).toContain('@types/node');
      expect(result.length).toBe(2);
    });
  });

  describe('extractProductionDependencies', () => {
    test('should return only dependencies', () => {
      const result = extractProductionDependencies(mockPackageJson);
      expect(result).toContain('react');
      expect(result).toContain('ts-pattern');
      expect(result).not.toContain('react-dom');
      expect(result).not.toContain('@types/node');
      expect(result).not.toContain('typescript');
      expect(result.length).toBe(2);
      expect(Array.isArray(result)).toBe(true);
    });

    test('should exclude devDependencies', () => {
      const result = extractProductionDependencies(mockPackageJson);
      expect(result).not.toContain('@types/node');
      expect(result).not.toContain('typescript');
    });

    test('should return empty array when no production dependencies', () => {
      const pkg: PackageJson = {
        name: O.Some('test'),
        version: O.Some('1.0.0'),
        dependencies: O.None,
        devDependencies: O.Some({ jest: '^29.0.0' }),
        peerDependencies: O.None,
      };
      const result = extractProductionDependencies(pkg);
      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    test('should handle only dependencies without peerDependencies', () => {
      const pkg: PackageJson = {
        name: O.Some('test'),
        version: O.Some('1.0.0'),
        dependencies: O.Some({ lodash: '^4.0.0' }),
        devDependencies: O.None,
        peerDependencies: O.None,
      };
      const result = extractProductionDependencies(pkg);
      expect(result).toContain('lodash');
      expect(result.length).toBe(1);
    });

    test('should handle only peerDependencies without dependencies', () => {
      const pkg: PackageJson = {
        name: O.Some('test'),
        version: O.Some('1.0.0'),
        dependencies: O.None,
        devDependencies: O.None,
        peerDependencies: O.Some({ react: '^18.0.0' }),
      };
      const result = extractProductionDependencies(pkg);
      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });
  });

  describe('extractDependencies', () => {
    test('should return only devDependencies', () => {
      const result = extractDependencies(mockPackageJson, 'devDependencies');
      expect(result).toContain('@types/node');
      expect(result).toContain('typescript');
      expect(result.length).toBe(2);
      expect(result).not.toContain('react');
      expect(result).not.toContain('react-dom');
      expect(Array.isArray(result)).toBe(true);
    });

    test('should return only dependencies', () => {
      const result = extractDependencies(mockPackageJson, 'dependencies');
      expect(result).toContain('react');
      expect(result).toContain('ts-pattern');
      expect(result.length).toBe(2);
      expect(result).not.toContain('@types/node');
      expect(result).not.toContain('typescript');
      expect(Array.isArray(result)).toBe(true);
    });

    test('should return only peerDependencies', () => {
      const result = extractDependencies(mockPackageJson, 'peerDependencies');
      expect(result).toContain('react-dom');
      expect(result.length).toBe(1);
      expect(result).not.toContain('react');
      expect(result).not.toContain('@types/node');
    });

    test('should return empty array when dependency type is None', () => {
      const pkg: PackageJson = {
        name: O.Some('test'),
        version: O.Some('1.0.0'),
        dependencies: O.None,
        devDependencies: O.None,
        peerDependencies: O.None,
      };
      expect(extractDependencies(pkg, 'dependencies')).toEqual([]);
      expect(extractDependencies(pkg, 'devDependencies')).toEqual([]);
      expect(extractDependencies(pkg, 'peerDependencies')).toEqual([]);
    });

    test('should handle empty dependency objects', () => {
      const pkg: PackageJson = {
        name: O.Some('test'),
        version: O.Some('1.0.0'),
        dependencies: O.Some({}),
        devDependencies: O.Some({}),
        peerDependencies: O.Some({}),
      };
      expect(extractDependencies(pkg, 'dependencies')).toEqual([]);
      expect(extractDependencies(pkg, 'devDependencies')).toEqual([]);
      expect(extractDependencies(pkg, 'peerDependencies')).toEqual([]);
    });
  });

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
      expect(R.isOk(result)).toBe(true);

      if (R.isOk(result)) {
        const pkg = R.getExn(result);
        expect(O.isSome(pkg.name)).toBe(true);
        expect(O.getExn(pkg.name)).toBe('test-package');
        expect(O.isSome(pkg.version)).toBe(true);
        expect(O.getExn(pkg.version)).toBe('1.0.0');
      }
    });

    test('should handle package.json with missing optional fields', async () => {
      const packageData = {
        name: 'test-package',
      };

      await writeFile(testFile, JSON.stringify(packageData));

      const result = readPackageJson(testFile);
      expect(R.isOk(result)).toBe(true);

      if (R.isOk(result)) {
        const pkg = R.getExn(result);
        expect(O.isSome(pkg.name)).toBe(true);
        expect(O.isNone(pkg.version)).toBe(true);
        expect(O.isNone(pkg.dependencies)).toBe(true);
        expect(O.isNone(pkg.devDependencies)).toBe(true);
        expect(O.isNone(pkg.peerDependencies)).toBe(true);
      }
    });

    test('should return error for non-existent file', () => {
      const result = readPackageJson('./non-existent/package.json');
      expect(R.isError(result)).toBe(true);
    });

    test('should return error for invalid JSON', async () => {
      await writeFile(testFile, 'invalid json content');

      const result = readPackageJson(testFile);
      expect(R.isError(result)).toBe(true);
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
      expect(R.isOk(result)).toBe(true);

      if (R.isOk(result)) {
        const pkg = R.getExn(result);
        expect(O.isSome(pkg.name)).toBe(true);
        expect(O.getExn(pkg.name)).toBe('full-package');
        expect(O.isSome(pkg.version)).toBe(true);
        expect(O.getExn(pkg.version)).toBe('2.0.0');
        expect(O.isSome(pkg.dependencies)).toBe(true);
        expect(O.isSome(pkg.devDependencies)).toBe(true);
        expect(O.isSome(pkg.peerDependencies)).toBe(true);
      }
    });

    test('should handle package.json with null values', async () => {
      const packageData = {
        name: 'test-package',
        version: null,
        dependencies: null,
      };

      await writeFile(testFile, JSON.stringify(packageData));

      const result = readPackageJson(testFile);
      expect(R.isOk(result)).toBe(true);

      if (R.isOk(result)) {
        const pkg = R.getExn(result);
        expect(O.isSome(pkg.name)).toBe(true);
        expect(O.isNone(pkg.version)).toBe(true);
        expect(O.isNone(pkg.dependencies)).toBe(true);
      }
    });

    test('should handle package.json with undefined values', async () => {
      const packageData = {
        name: 'test-package',
      };

      await writeFile(testFile, JSON.stringify(packageData));

      const result = readPackageJson(testFile);
      expect(R.isOk(result)).toBe(true);

      if (R.isOk(result)) {
        const pkg = R.getExn(result);
        expect(O.isSome(pkg.name)).toBe(true);
        expect(O.isNone(pkg.version)).toBe(true);
      }
    });

    test('should handle scoped package names', async () => {
      const packageData = {
        name: '@myorg/my-package',
        version: '1.0.0',
      };

      await writeFile(testFile, JSON.stringify(packageData));

      const result = readPackageJson(testFile);
      expect(R.isOk(result)).toBe(true);

      if (R.isOk(result)) {
        const pkg = R.getExn(result);
        expect(O.isSome(pkg.name)).toBe(true);
        expect(O.getExn(pkg.name)).toBe('@myorg/my-package');
      }
    });

    test('should return error message for non-existent file', () => {
      const result = readPackageJson('./non-existent/package.json');
      expect(R.isError(result)).toBe(true);
    });

    test('should return error message for invalid JSON', async () => {
      await writeFile(testFile, '{ invalid json }');

      const result = readPackageJson(testFile);
      expect(R.isError(result)).toBe(true);
    });
  });

  describe('edge cases', () => {
    test('extractAllDependencies handles empty dep object alongside None ones', () => {
      const pkg: PackageJson = {
        name: O.None,
        version: O.None,
        dependencies: O.Some({}),
        devDependencies: O.None,
        peerDependencies: O.Some({}),
      };
      expect(extractAllDependencies(pkg)).toEqual([]);
    });

    test('extractAllDependencies preserves insertion order across types (dep > devDep > peerDep)', () => {
      const pkg: PackageJson = {
        name: O.None,
        version: O.None,
        dependencies: O.Some({ a: '1', b: '1' }),
        devDependencies: O.Some({ c: '1' }),
        peerDependencies: O.Some({ d: '1' }),
      };
      const result = extractAllDependencies(pkg);
      expect(result).toEqual(['a', 'b', 'c', 'd']);
    });

    test('extractAllDependencies scales to large dep lists without throwing', () => {
      const big = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`pkg-${i}`, '1.0.0']));
      const pkg: PackageJson = {
        name: O.None,
        version: O.None,
        dependencies: O.Some(big),
        devDependencies: O.None,
        peerDependencies: O.None,
      };
      const result = extractAllDependencies(pkg);
      expect(result.length).toBe(1000);
      expect(new Set(result).size).toBe(1000);
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

    test('returns Ok with all-None when content is an empty object', async () => {
      await writeFile(testFile, '{}');
      const result = readPackageJson(testFile);
      expect(R.isOk(result)).toBe(true);
      if (R.isOk(result)) {
        const pkg = R.getExn(result);
        expect(O.isNone(pkg.name)).toBe(true);
        expect(O.isNone(pkg.dependencies)).toBe(true);
      }
    });

    test('returns PARSE_ERROR for empty file (JSON.parse fails)', async () => {
      await writeFile(testFile, '');
      const result = readPackageJson(testFile);
      expect(R.isError(result)).toBe(true);
      R.match(
        result,
        () => {
          throw new Error('Should not be Ok');
        },
        (err) => {
          expect(err.type).toBe('PARSE_ERROR');
        },
      );
    });

    test('rejects array as top-level JSON with PARSE_ERROR (not a plain object)', async () => {
      await writeFile(testFile, '[1, 2, 3]');
      const result = readPackageJson(testFile);
      expect(R.isError(result)).toBe(true);
      R.match(
        result,
        () => {
          throw new Error('Should not be Ok');
        },
        (err) => {
          expect(err.type).toBe('PARSE_ERROR');
        },
      );
    });

    test('rejects null as top-level JSON with PARSE_ERROR', async () => {
      await writeFile(testFile, 'null');
      const result = readPackageJson(testFile);
      expect(R.isError(result)).toBe(true);
    });

    test('rejects primitive top-level JSON with PARSE_ERROR', async () => {
      await writeFile(testFile, '"just a string"');
      const result = readPackageJson(testFile);
      expect(R.isError(result)).toBe(true);
    });

    test('returns PARSE_ERROR for json with trailing garbage', async () => {
      await writeFile(testFile, '{"name":"x"}garbage');
      const result = readPackageJson(testFile);
      expect(R.isError(result)).toBe(true);
    });
  });
});
