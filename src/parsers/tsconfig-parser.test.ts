import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

  test('a relative extends into node_modules names the package', async () => {
    await write('tsconfig.json', { extends: './node_modules/@tsconfig/node20/tsconfig.json' });
    await write('node_modules/@tsconfig/node20/tsconfig.json', {});
    expect(usages()).toEqual(['@tsconfig/node20:type-only:development:tsconfig.json:2']);
  });

  test('a parent shared by tsconfig.json and tsconfig.base.json counts once', async () => {
    await write('tsconfig.json', { extends: './shared.json' });
    await write('tsconfig.base.json', { extends: './shared.json' });
    await write('shared.json', { extends: '@tsconfig/strictest/tsconfig.json' });
    await write('node_modules/@tsconfig/strictest/tsconfig.json', {});
    expect(usages()).toEqual(['@tsconfig/strictest:type-only:development:shared.json:2']);
  });

  test('a child importHelpers: false or null turns the inherited tslib usage off', async () => {
    await write('tsconfig.base.json', { compilerOptions: { importHelpers: true } });
    await write('tsconfig.json', { extends: './tsconfig.base.json', compilerOptions: { importHelpers: false } });
    expect(usages()).toEqual([]);
    await write('tsconfig.json', { extends: './tsconfig.base.json', compilerOptions: { importHelpers: null } });
    expect(usages()).toEqual([]);
  });

  test('a child types: null clears the inherited types', async () => {
    await write('tsconfig.base.json', { compilerOptions: { types: ['node'] } });
    await write('tsconfig.json', { extends: './tsconfig.base.json', compilerOptions: { types: null } });
    expect(usages()).toEqual([]);
  });
});
