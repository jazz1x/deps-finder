import { Array } from 'effect';

type Range = readonly [lo: number, hi: number];

export const buildLineStarts = (content: string): ReadonlyArray<number> => [
  0,
  ...Array.map(Array.fromIterable(content.matchAll(/\n/g)), (newline) => newline.index + 1),
];

const halve =
  (sorted: ReadonlyArray<number>, value: number) =>
  ([lo, hi]: Range): Range => {
    const mid = (lo + hi) >>> 1;
    return (sorted[mid] as number) <= value ? [mid + 1, hi] : [lo, mid];
  };

const upperBound = (sorted: ReadonlyArray<number>, value: number, range: Range): number =>
  range[0] === range[1] ? range[0] : upperBound(sorted, value, halve(sorted, value)(range));

// Called once per reference, so a scan per lookup would be quadratic on long files.
export const lineNumberAt = (lineStarts: ReadonlyArray<number>, offset: number): number =>
  upperBound(lineStarts, offset, [0, lineStarts.length]);
