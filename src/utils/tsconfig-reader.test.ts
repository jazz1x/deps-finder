import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { Result } from 'effect';
import { readTsConfig } from './tsconfig-reader';

describe('tsconfig-reader', () => {
  const testDir = './test-tsconfig-reader';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('readTsConfig - returns Ok for valid tsconfig.json', async () => {
    await writeFile(`${testDir}/tsconfig.json`, JSON.stringify({ compilerOptions: { outDir: 'dist' } }));

    const result = readTsConfig(testDir);
    expect(Result.isSuccess(result)).toBe(true);
    expect(Result.getOrThrow(result).compilerOptions?.outDir).toBe('dist');
  });

  test('readTsConfig - returns Error for missing tsconfig.json', () => {
    const result = readTsConfig(testDir);
    expect(Result.isFailure(result)).toBe(true);
  });
});
