import { describe, expect, test } from 'bun:test';
import { Exit } from 'effect';
import { FileError, IssuesFound } from '@/domain/errors';
import { exitCodeOf } from './exit-code';

describe('exitCodeOf', () => {
  test.each([
    ['success', Exit.succeed(undefined), 0],
    ['issues found', Exit.fail(IssuesFound({ total: 3 })), 1],
    ['file error', Exit.fail(FileError.FileNotFound({ path: 'package.json' })), 2],
    ['crash', Exit.die(new Error('boom')), 2],
    ['signal', Exit.interrupt(1), 130],
  ])('%s', (_, exit, code) => {
    expect(exitCodeOf(exit)).toBe(code);
  });
});
