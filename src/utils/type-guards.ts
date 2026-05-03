/**
 * 타입 가드 유틸리티
 *
 * 사용처가 생기는 시점에 가드를 추가한다 (CLAUDE.md C5).
 */

export const isString = (value: unknown): value is string => typeof value === 'string';

export const isNotNullable = <T>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined;

/**
 * JSON object 형태(`{ ... }`)인지 확인 — array나 null은 제외.
 */
export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
