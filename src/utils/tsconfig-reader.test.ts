import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FileError } from '@/domain/errors';
import { outDirsOf, readRootTsConfigs, readTsConfigChains } from './tsconfig-reader';

describe('tsconfig-reader', () => {
  const testDir = './test-tsconfig-reader';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const write = async (file: string, json: unknown) => {
    await mkdir(path.dirname(path.join(testDir, file)), { recursive: true });
    await writeFile(path.join(testDir, file), JSON.stringify(json));
  };

  test('reads outDir from tsconfig.json and tsconfig.base.json', async () => {
    await writeFile(`${testDir}/tsconfig.json`, JSON.stringify({ compilerOptions: { outDir: 'dist' } }));
    await writeFile(`${testDir}/tsconfig.base.json`, '{ "compilerOptions": { "outDir": "lib", }, }');

    expect(outDirsOf(readRootTsConfigs(testDir).found)).toEqual(['dist', 'lib']);
  });

  test('a declarationDir is a build directory too', async () => {
    await write('tsconfig.json', { compilerOptions: { outDir: 'dist', declarationDir: 'typings' } });
    expect(outDirsOf(readRootTsConfigs(testDir).found)).toEqual(['dist', 'typings']);
  });

  test('a null or mistyped option drops only that option', async () => {
    await write('tsconfig.json', { compilerOptions: { outDir: 'compiled', types: null, importHelpers: 'yes' } });
    await write('tsconfig.base.json', { extends: 3, compilerOptions: { outDir: 'lib', types: ['node', 1] } });
    const { found, skipped } = readRootTsConfigs(testDir);
    expect(outDirsOf(found)).toEqual(['compiled', 'lib']);
    expect(found.map((config) => config.compilerOptions?.types)).toEqual([null, undefined]);
    expect(skipped).toEqual([]);
  });

  test('ignores an empty outDir instead of excluding everything', async () => {
    await writeFile(`${testDir}/tsconfig.json`, JSON.stringify({ compilerOptions: { outDir: '' } }));
    expect(outDirsOf(readRootTsConfigs(testDir).found)).toEqual([]);
  });

  test('missing files are not a problem', () => {
    expect(readRootTsConfigs(testDir)).toEqual({ found: [], skipped: [] });
  });

  test('reports an unparseable tsconfig.base.json', async () => {
    await writeFile(`${testDir}/tsconfig.base.json`, '{ invalid json }');
    const { found, skipped } = readRootTsConfigs(testDir);
    expect(found).toEqual([]);
    expect(skipped.map(FileError.$is('ParseFailed'))).toEqual([true]);
  });
});

describe('readTsConfigChains', () => {
  const testDir = './test-tsconfig-chains';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const write = async (file: string, json: unknown) => {
    await mkdir(path.dirname(path.join(testDir, file)), { recursive: true });
    await writeFile(path.join(testDir, file), JSON.stringify(json));
  };

  const chainsFrom = (root: string) =>
    readTsConfigChains(root).found.map((chain) => chain.map((file) => path.relative(testDir, file.path)));

  test.each([
    ['a bare package', '@tsconfig/node20', 'node_modules/@tsconfig/node20/tsconfig.json'],
    ['a package file', '@tsconfig/node20/tsconfig.json', 'node_modules/@tsconfig/node20/tsconfig.json'],
    ['a file without .json', './configs/base', 'configs/base.json'],
  ])('extends %s', async (_, specifier, parent) => {
    await write('tsconfig.json', { extends: specifier });
    await write(parent, {});
    expect(chainsFrom(testDir)).toEqual([['tsconfig.json', parent]]);
  });

  test('a package extends resolves through node_modules above the project', async () => {
    await write('pkg/tsconfig.json', { extends: '@tsconfig/node20/tsconfig.json' });
    await write('node_modules/@tsconfig/node20/tsconfig.json', {});
    const { found, skipped } = readTsConfigChains(path.join(testDir, 'pkg'));
    expect(found.map((chain) => chain.map((file) => path.relative(testDir, file.path)))).toEqual([
      ['pkg/tsconfig.json', 'node_modules/@tsconfig/node20/tsconfig.json'],
    ]);
    expect(skipped).toEqual([]);
  });

  test('an extends array lists the later entry nearer', async () => {
    await write('tsconfig.json', { extends: ['./a.json', './b.json'] });
    await write('a.json', {});
    await write('b.json', {});
    expect(chainsFrom(testDir)).toEqual([['tsconfig.json', 'b.json', 'a.json']]);
  });

  test('a missing extended file is skipped, and an extends cycle ends', async () => {
    await write('tsconfig.json', { extends: ['./missing', './tsconfig.base.json'] });
    await write('tsconfig.base.json', { extends: './tsconfig.json' });
    const { found, skipped } = readTsConfigChains(testDir);
    expect(found.map((chain) => chain.map((file) => path.relative(testDir, file.path)))).toEqual([['tsconfig.json', 'tsconfig.base.json']]);
    expect(skipped.map(FileError.$is('FileNotFound'))).toEqual([true]);
  });
});
