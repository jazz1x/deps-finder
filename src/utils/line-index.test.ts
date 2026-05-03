import { describe, expect, test } from 'bun:test';
import { buildLineStarts, lineNumberAt } from './line-index';

describe('buildLineStarts', () => {
  test('empty string yields a single line starting at 0', () => {
    expect(buildLineStarts('')).toEqual([0]);
  });

  test('single-line content yields [0]', () => {
    expect(buildLineStarts('hello world')).toEqual([0]);
  });

  test('records each line start after a newline', () => {
    // "a\nbb\nccc"
    //  0  2   5
    expect(buildLineStarts('a\nbb\nccc')).toEqual([0, 2, 5]);
  });

  test('handles trailing newline (treats post-\\n as next line start)', () => {
    expect(buildLineStarts('a\n')).toEqual([0, 2]);
  });

  test('handles consecutive newlines (empty lines)', () => {
    // "\n\n\n" → starts at 0, 1, 2, 3
    expect(buildLineStarts('\n\n\n')).toEqual([0, 1, 2, 3]);
  });

  test('CR-only lines do not split (only \\n is a line terminator here)', () => {
    // 의도적으로 \r 단독은 라인 분리로 취급하지 않는다 — 기존 split('\n') 동작과 일치
    expect(buildLineStarts('a\rb')).toEqual([0]);
  });
});

describe('lineNumberAt', () => {
  // "abc\nde\nfgh"
  //  0123 456 789
  // 줄 시작: [0, 4, 7] (1줄=0, 2줄=4, 3줄=7)
  const starts = buildLineStarts('abc\nde\nfgh');

  test('offset 0 is line 1', () => {
    expect(lineNumberAt(starts, 0)).toBe(1);
  });

  test('offset within line 1', () => {
    expect(lineNumberAt(starts, 2)).toBe(1);
  });

  test('offset at the newline char itself counts as the line being terminated', () => {
    // index 3 == '\n' of line 1 → 여전히 1줄
    expect(lineNumberAt(starts, 3)).toBe(1);
  });

  test('offset right after newline starts the next line', () => {
    expect(lineNumberAt(starts, 4)).toBe(2);
  });

  test('offset on the last line', () => {
    expect(lineNumberAt(starts, 9)).toBe(3);
  });

  test('offset beyond content length still returns last line', () => {
    expect(lineNumberAt(starts, 999)).toBe(3);
  });

  test('matches naive substring().split() reference for many random offsets', () => {
    // 임의 콘텐츠로 reference 구현과 결과 일치 검증 (회귀 가드)
    const content = 'line1\nline two\n\n\nfinal line content here\nx\n';
    const idx = buildLineStarts(content);
    const naive = (s: string, off: number): number => s.substring(0, Math.min(off, s.length)).split('\n').length;
    for (let off = 0; off <= content.length + 5; off++) {
      const expected = naive(content, off);
      const actual = lineNumberAt(idx, off);
      expect(actual).toBe(expected);
    }
  });
});
