import { describe, expect, test } from 'bun:test';
import { formatFileError } from './error-reporter';

describe('formatFileError', () => {
  test('FILE_NOT_FOUND renders human-readable message with path', () => {
    const msg = formatFileError({ type: 'FILE_NOT_FOUND', path: './pkg.json' });
    expect(msg).toContain('./pkg.json');
    expect(msg).not.toContain('FILE_NOT_FOUND');
    expect(msg).not.toContain('{');
  });

  test('PARSE_ERROR includes underlying message but not stack trace', () => {
    const msg = formatFileError({
      type: 'PARSE_ERROR',
      path: './pkg.json',
      error: new Error('Unexpected token'),
    });
    expect(msg).toContain('Unexpected token');
    expect(msg).toContain('./pkg.json');
    expect(msg).not.toContain('at JSON.parse');
  });

  test('READ_ERROR includes underlying message', () => {
    const msg = formatFileError({
      type: 'READ_ERROR',
      path: '/etc/secret',
      error: new Error('EACCES: permission denied'),
    });
    expect(msg).toContain('EACCES');
    expect(msg).toContain('/etc/secret');
  });
});
