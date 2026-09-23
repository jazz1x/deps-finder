import { Array } from 'effect';
import type { ImportLocation } from '../domain/types.js';

export const deduplicateLocations = (
  locations: ReadonlyArray<ImportLocation>,
): ReadonlyArray<ImportLocation> =>
  Array.dedupeWith(locations, (a, b) => a.file === b.file && a.line === b.line);
