import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { R } from '@mobily/ts-belt';
import { readFile, readJSONFile } from './file-reader';

describe('file-reader', () => {
  const testDir = './test-file-reader';

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('readFile', () => {
    test('returns Ok for valid file', async () => {
      const filePath = `${testDir}/test.txt`;
      await writeFile(filePath, 'hello world');

      const result = readFile(filePath);
      expect(R.isOk(result)).toBe(true);
      expect(R.getExn(result)).toBe('hello world');
    });

    test('returns FILE_NOT_FOUND for non-existent file', () => {
      const result = readFile(`${testDir}/non-existent.txt`);
      expect(R.isError(result)).toBe(true);
      R.match(
        result,
        () => {
          throw new Error('Should not be Ok');
        },
        (error) => {
          expect(error.type).toBe('FILE_NOT_FOUND');
          if (error.type === 'FILE_NOT_FOUND') {
            expect(error.path).toContain('non-existent.txt');
          }
        },
      );
    });

    test('returns READ_ERROR for non-ENOENT failures (e.g. directory passed as file)', () => {
      // 디렉토리를 readFileSync로 읽으면 EISDIR (ENOENT 아님) → READ_ERROR로 매핑돼야 함
      const result = readFile(testDir);
      expect(R.isError(result)).toBe(true);
      R.match(
        result,
        () => {
          throw new Error('Should not be Ok');
        },
        (error) => {
          expect(error.type).toBe('READ_ERROR');
          if (error.type === 'READ_ERROR') {
            expect(error.path).toBe(testDir);
            expect(error.error).toBeInstanceOf(Error);
          }
        },
      );
    });
  });

  describe('readJSONFile', () => {
    test('parses valid JSON', async () => {
      const filePath = `${testDir}/test.json`;
      await writeFile(filePath, JSON.stringify({ name: 'test' }));

      const result = readJSONFile<{ name: string }>(filePath);
      expect(R.isOk(result)).toBe(true);
      expect(R.getExn(result).name).toBe('test');
    });

    test('returns PARSE_ERROR for invalid JSON', async () => {
      const filePath = `${testDir}/invalid.json`;
      await writeFile(filePath, '{ invalid }');

      const result = readJSONFile(filePath);
      expect(R.isError(result)).toBe(true);
      R.match(
        result,
        () => {
          throw new Error('Should not be Ok');
        },
        (error) => {
          expect(error.type).toBe('PARSE_ERROR');
        },
      );
    });
  });
});
