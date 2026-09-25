import { describe, expect, test } from 'bun:test';
import { coloursOn, isTerminalOf } from './terminal';

describe('terminal', () => {
  test('a worker takes the main thread word over its own piped stdout', () => {
    expect(isTerminalOf({ stdoutIsTerminal: true }, undefined)).toBe(true);
    expect(isTerminalOf({ stdoutIsTerminal: false }, true)).toBe(false);
    expect(isTerminalOf(null, true)).toBe(true);
    expect(isTerminalOf(null, undefined)).toBe(false);
  });

  test.each([
    [true, undefined, true],
    [true, '', true],
    [true, '1', false],
    [false, undefined, false],
  ] as const)('coloursOn(isTerminal=%p, NO_COLOR=%p)', (isTerminal, noColor, expected) => {
    expect(coloursOn(isTerminal, noColor)).toBe(expected);
  });
});
