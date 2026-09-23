import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FileError } from '@/domain/errors';
import { readTsConfigImports } from './tsconfig-parser';

describe('readTsConfigImports', () => {
  const testDir = './test-tsconfig-parser';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const write = async (file: string, json: unknown) => {
    await mkdir(path.dirname(path.join(testDir, file)), { recursive: true });
    await writeFile(path.join(testDir, file), JSON.stringify(json, null, 2));
  };

  const usages = () =>
    readTsConfigImports(testDir).found.map(
      (found) => `${found.packageName}:${found.importType}:${found.context}:${path.relative(testDir, found.file)}:${found.line}`,
    );

  test('types entries are development type usage', async () => {
    await write('tsconfig.json', { compilerOptions: { types: ['node', 'bun-types/test-globals', '@types/jest', './local'] } });
    expect(usages()).toEqual([
      'node:type-only:development:tsconfig.json:3',
      'bun-types:type-only:development:tsconfig.json:3',
      '@types/jest:type-only:development:tsconfig.json:3',
    ]);
  });

  test('follows extends through a relative file and an installed package; the nearest types wins', async () => {
    await write('tsconfig.json', { extends: './tsconfig.base.json' });
    await write('tsconfig.base.json', { extends: '@tsconfig/node20/tsconfig.json', compilerOptions: { types: ['vitest/globals'] } });
    await write('node_modules/@tsconfig/node20/tsconfig.json', { compilerOptions: { types: ['node'], importHelpers: true } });
    expect(usages()).toEqual([
      '@tsconfig/node20:type-only:development:tsconfig.base.json:2',
      'vitest:type-only:development:tsconfig.base.json:4',
      'tslib:runtime:production:node_modules/@tsconfig/node20/tsconfig.json:6',
    ]);
  });

  test.each([
    ['a bare package', '@tsconfig/node20', 'node_modules/@tsconfig/node20/tsconfig.json'],
    ['a file without .json', './configs/base', 'configs/base.json'],
  ])('extends %s', async (_, specifier, parent) => {
    await write('tsconfig.json', { extends: specifier });
    await write(parent, { compilerOptions: { types: ['node'] } });
    expect(readTsConfigImports(testDir).found.map((usage) => usage.packageName)).toContain('node');
  });

  test('a package extends resolves through node_modules above the project', async () => {
    await write('pkg/tsconfig.json', { extends: '@tsconfig/node20/tsconfig.json' });
    await write('node_modules/@tsconfig/node20/tsconfig.json', { compilerOptions: { types: ['node'] } });
    const { found, skipped } = readTsConfigImports(path.join(testDir, 'pkg'));
    expect(found.map((usage) => usage.packageName)).toEqual(['@tsconfig/node20', 'node']);
    expect(skipped).toEqual([]);
  });

  test('a parent shared by tsconfig.json and tsconfig.base.json counts once', async () => {
    await write('tsconfig.json', { extends: './shared.json' });
    await write('tsconfig.base.json', { extends: './shared.json' });
    await write('shared.json', { extends: '@tsconfig/strictest/tsconfig.json' });
    await write('node_modules/@tsconfig/strictest/tsconfig.json', {});
    expect(usages()).toEqual(['@tsconfig/strictest:type-only:development:shared.json:2']);
  });

  test('a child importHelpers: false turns the inherited tslib usage off', async () => {
    await write('tsconfig.json', { extends: './tsconfig.base.json', compilerOptions: { importHelpers: false } });
    await write('tsconfig.base.json', { compilerOptions: { importHelpers: true } });
    expect(usages()).toEqual([]);
  });

  test('in an extends array the later entry wins', async () => {
    await write('tsconfig.json', { extends: ['./a.json', './b.json'] });
    await write('a.json', { compilerOptions: { types: ['from-a'] } });
    await write('b.json', { compilerOptions: { types: ['from-b'] } });
    expect(readTsConfigImports(testDir).found.map((usage) => usage.packageName)).toEqual(['from-b']);
  });

  test('a missing extended file is skipped, and an extends cycle ends', async () => {
    await write('tsconfig.json', { extends: ['./missing', './tsconfig.base.json'] });
    await write('tsconfig.base.json', { extends: './tsconfig.json', compilerOptions: { types: ['node'] } });
    const { found, skipped } = readTsConfigImports(testDir);
    expect(found.map((usage) => usage.packageName)).toEqual(['node']);
    expect(skipped.map(FileError.$is('FileNotFound'))).toEqual([true]);
  });
});
