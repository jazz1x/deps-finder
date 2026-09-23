import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { Result, Schema } from 'effect';
import { FileError } from '@/domain/errors';
import { gatherOptional, readFile, readJsonFile } from './file-reader';

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
      expect(Result.isSuccess(result)).toBe(true);
      expect(Result.getOrThrow(result)).toBe('hello world');
    });

    test('returns FileNotFound for non-existent file', () => {
      const result = readFile(`${testDir}/non-existent.txt`);
      expect(Result.isFailure(result)).toBe(true);
      Result.match(result, {
        onSuccess: () => {
          throw new Error('Should not be Ok');
        },
        onFailure: (error) => {
          expect(FileError.$is('FileNotFound')(error)).toBe(true);
          expect(error.path).toContain('non-existent.txt');
        },
      });
    });

    test('returns ReadFailed for non-ENOENT failures (e.g. directory passed as file)', () => {
      // 디렉토리를 readFileSync로 읽으면 EISDIR (ENOENT 아님) → ReadFailed로 매핑돼야 함
      const result = readFile(testDir);
      expect(Result.isFailure(result)).toBe(true);
      Result.match(result, {
        onSuccess: () => {
          throw new Error('Should not be Ok');
        },
        onFailure: (error) => {
          expect(FileError.$is('ReadFailed')(error)).toBe(true);
          expect(error.path).toBe(testDir);
          if (FileError.$is('ReadFailed')(error)) {
            expect(typeof error.reason).toBe('string');
            expect(error.reason.length).toBeGreaterThan(0);
          }
        },
      });
    });
  });

  describe('readJsonFile', () => {
    test('parses valid JSON', async () => {
      const filePath = `${testDir}/test.json`;
      await writeFile(filePath, JSON.stringify({ name: 'test' }));

      const result = readJsonFile(Schema.Struct({ name: Schema.String }))(filePath);
      expect(Result.isSuccess(result)).toBe(true);
      expect(Result.getOrThrow(result).name).toBe('test');
    });

    test('returns ParseFailed for invalid JSON', async () => {
      const filePath = `${testDir}/invalid.json`;
      await writeFile(filePath, '{ invalid }');

      const result = readJsonFile(Schema.Unknown)(filePath);
      expect(Result.isFailure(result)).toBe(true);
      Result.match(result, {
        onSuccess: () => {
          throw new Error('Should not be Ok');
        },
        onFailure: (error) => {
          expect(FileError.$is('ParseFailed')(error)).toBe(true);
        },
      });
    });
  });

  describe('gatherOptional', () => {
    test('treats a missing file as absent and keeps other failures', () => {
      const missing = FileError.FileNotFound({ path: 'a' });
      const broken = FileError.ParseFailed({ path: 'b', reason: 'bad' });

      expect(gatherOptional(Result.fail(missing))).toEqual({ found: [], skipped: [] });
      expect(gatherOptional(Result.fail(broken))).toEqual({ found: [], skipped: [broken] });
    });
  });
});
