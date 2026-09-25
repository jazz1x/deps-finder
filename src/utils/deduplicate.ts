import { Array, Record, pipe } from 'effect';
import type { ImportLocation } from '../domain/types.js';

export const deduplicateLocations = (
  locations: ReadonlyArray<ImportLocation>,
): ReadonlyArray<ImportLocation> =>
  pipe(
    locations,
    Array.groupBy((location) => `${location.file}:${location.line}`),
    Record.values,
    Array.map(Array.headNonEmpty),
  );
