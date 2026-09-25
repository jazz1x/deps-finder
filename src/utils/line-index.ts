import { Array } from 'effect';

export const buildLineStarts = (content: string): ReadonlyArray<number> =>
  Array.dropRight(
    Array.scan(content.split('\n'), 0, (start, line) => start + line.length + 1),
    1,
  );

const upperBound = (
  sorted: ReadonlyArray<number>,
  value: number,
  lo: number,
  hi: number,
): number => (lo === hi ? lo : narrow(sorted, value, lo, hi, (lo + hi) >>> 1));

const narrow = (
  sorted: ReadonlyArray<number>,
  value: number,
  lo: number,
  hi: number,
  mid: number,
): number =>
  (sorted[mid] as number) <= value
    ? upperBound(sorted, value, mid + 1, hi)
    : upperBound(sorted, value, lo, mid);

// Called once per reference, so a scan per lookup would be quadratic on long files.
export const lineNumberAt = (lineStarts: ReadonlyArray<number>, offset: number): number =>
  upperBound(lineStarts, offset, 0, lineStarts.length);
