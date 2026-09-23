import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { FileError } from '@/domain/errors';
import { aliasTargetsOf, outDirsOf, readRootTsConfigs } from './tsconfig-reader';

describe('tsconfig-reader', () => {
  const testDir = './test-tsconfig-reader';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('reads outDir from tsconfig.json and tsconfig.base.json', async () => {
    await writeFile(`${testDir}/tsconfig.json`, JSON.stringify({ compilerOptions: { outDir: 'dist' } }));
    await writeFile(`${testDir}/tsconfig.base.json`, '{ "compilerOptions": { "outDir": "lib", }, }');

    expect(outDirsOf(readRootTsConfigs(testDir).found)).toEqual(['dist', 'lib']);
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

  test('alias targets resolve against baseUrl and stop at a wildcard', () => {
    const paths = { '@x/a': ['libs/a/src/index.ts'], '@x/b/*': ['./libs/b/src/*'], '@/*': ['*'] };
    expect(aliasTargetsOf([{ compilerOptions: { paths } }])).toEqual(['libs/a/src/index.ts/', 'libs/b/src/', '']);
    expect(aliasTargetsOf([{ compilerOptions: { baseUrl: './src', paths } }])).toEqual([
      'src/libs/a/src/index.ts/',
      'src/libs/b/src/',
      'src/',
    ]);
  });
});
