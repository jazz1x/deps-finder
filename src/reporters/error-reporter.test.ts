import { describe, expect, test } from 'bun:test';
import { FileError } from '@/domain/errors';
import { formatFileError, formatSkippedInput } from './error-reporter';

describe('formatFileError', () => {
  test('FileNotFound renders human-readable message with path', () => {
    const msg = formatFileError(FileError.FileNotFound({ path: './pkg.json' }));
    expect(msg).toContain('./pkg.json');
    expect(msg).not.toContain('FileNotFound');
    expect(msg).not.toContain('{');
  });

  test('ParseFailed includes underlying message but not stack trace', () => {
    const msg = formatFileError(
      FileError.ParseFailed({
        path: './pkg.json',
        reason: 'Unexpected token',
      }),
    );
    expect(msg).toContain('Unexpected token');
    expect(msg).toContain('./pkg.json');
    expect(msg).not.toContain('at JSON.parse');
  });

  test('ReadFailed includes underlying message', () => {
    const msg = formatFileError(
      FileError.ReadFailed({
        path: '/etc/secret',
        reason: 'EACCES: permission denied',
      }),
    );
    expect(msg).toContain('EACCES');
    expect(msg).toContain('/etc/secret');
  });
});

describe('formatSkippedInput', () => {
  test('names the input, the reason, and that the scan went on', () => {
    expect(formatSkippedInput(FileError.ParseFailed({ path: 'pkgs/bad/package.json', reason: 'Unexpected end of JSON input' }))).toBe(
      'warning: could not use pkgs/bad/package.json (Unexpected end of JSON input); the scan went on without it.',
    );
  });
});
