/**
 * Chaos / fuzz tests
 *
 * 목적: 무작위(시드 고정) 입력에 대해 핵심 함수들이
 *  - 절대 throw 하지 않고
 *  - 계약된 반환 타입을 유지
 * 함을 보장.
 *
 * 시드 고정으로 결정적(deterministic). 실패 시 동일 시드 재현 가능.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { O, R } from '@mobily/ts-belt';
import { analyzeDependencies } from '@/analyzers/dependency-analyzer';
import { extractImports, extractPackageName, parseFile } from '@/parsers/import-parser';
import { extractAllDependencies, extractDependencies, readPackageJson } from '@/parsers/package-parser';
import type { PackageJson } from '@/domain/types';
import { makeRng } from '@/test-utils/random';
import { readFile, readJSONFile } from '@/utils/file-reader';

const FUZZ_ITERATIONS = 200;
const FIXTURE_DIR = './test-chaos';

const randomString = (rng: () => number, maxLen = 64): string => {
  const len = Math.floor(rng() * maxLen);
  // ASCII printable + 일부 제어 문자 + 일부 멀티바이트 문자 섞기
  const charPool = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@/.-_:\'"`{}[]()<>;,! \t\n한日✓🚀';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += charPool[Math.floor(rng() * charPool.length)];
  }
  return out;
};

const randomImportLikeContent = (rng: () => number): string => {
  const lines: string[] = [];
  const lineCount = Math.floor(rng() * 20);
  for (let i = 0; i < lineCount; i++) {
    const flavor = Math.floor(rng() * 6);
    const pkg = randomString(rng, 24);
    if (flavor === 0) lines.push(`import x from '${pkg}';`);
    else if (flavor === 1) lines.push(`import { a, b } from "${pkg}";`);
    else if (flavor === 2) lines.push(`const m = require('${pkg}');`);
    else if (flavor === 3) lines.push(`import type T from '${pkg}';`);
    else if (flavor === 4) lines.push(`// random comment ${pkg}`);
    else lines.push(randomString(rng, 80));
  }
  return lines.join('\n');
};

const randomPackageJsonShape = (rng: () => number): PackageJson => {
  const maybeDeps = (): O.Option<Record<string, string>> => {
    if (rng() < 0.3) return O.None;
    const count = Math.floor(rng() * 30);
    const obj: Record<string, string> = {};
    for (let i = 0; i < count; i++) {
      obj[randomString(rng, 16) || `pkg${i}`] = '1.0.0';
    }
    return O.Some(obj);
  };
  return {
    name: rng() < 0.5 ? O.Some(randomString(rng, 16)) : O.None,
    version: rng() < 0.5 ? O.Some('1.0.0') : O.None,
    dependencies: maybeDeps(),
    devDependencies: maybeDeps(),
    peerDependencies: maybeDeps(),
  };
};

describe('chaos: extractPackageName never throws', () => {
  const rng = makeRng(0xc0ffee);
  test(`returns string|null on ${FUZZ_ITERATIONS} random inputs`, () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const input = randomString(rng, 80);
      const result = extractPackageName(input);
      expect(result === null || typeof result === 'string').toBe(true);
    }
  });

  test('handles null and undefined explicitly', () => {
    expect(extractPackageName(null)).toBe(null);
    expect(extractPackageName(undefined)).toBe(null);
  });
});

describe('chaos: extractImports never throws', () => {
  const rng = makeRng(0xdeadbeef);
  test(`returns ImportDetails[] on ${FUZZ_ITERATIONS} random source-like inputs`, () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const content = randomImportLikeContent(rng);
      const findings = extractImports(content, 'fuzz.ts');
      expect(Array.isArray(findings)).toBe(true);
      // 모든 finding이 계약된 shape를 가져야 한다
      for (const f of findings) {
        expect(typeof f.packageName).toBe('string');
        expect(['runtime', 'type-only']).toContain(f.importType);
        expect(typeof f.line).toBe('number');
        expect(f.line).toBeGreaterThan(0);
      }
    }
  });

  test('does not throw on pure-garbage byte content', () => {
    const rng2 = makeRng(0x12345);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const garbage = randomString(rng2, 200);
      expect(() => extractImports(garbage, 'garbage.ts')).not.toThrow();
    }
  });
});

describe('chaos: extractDependencies / extractAllDependencies handle arbitrary shapes', () => {
  const rng = makeRng(0xabcdef);
  test(`returns string[] on ${FUZZ_ITERATIONS} random package.json shapes`, () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const pkg = randomPackageJsonShape(rng);
      const all = extractAllDependencies(pkg);
      expect(Array.isArray(all)).toBe(true);
      // 중복 없음 보장
      expect(new Set(all).size).toBe(all.length);

      const deps = extractDependencies(pkg, 'dependencies');
      const devDeps = extractDependencies(pkg, 'devDependencies');
      const peer = extractDependencies(pkg, 'peerDependencies');
      expect(Array.isArray(deps)).toBe(true);
      expect(Array.isArray(devDeps)).toBe(true);
      expect(Array.isArray(peer)).toBe(true);
    }
  });
});

describe('chaos: analyzeDependencies on random inputs', () => {
  const rng = makeRng(0x55aa55);
  test('never throws and returns well-formed AnalysisResult', () => {
    for (let i = 0; i < 50; i++) {
      const pkg = randomPackageJsonShape(rng);
      const importCount = Math.floor(rng() * 20);
      const imports = Array.from({ length: importCount }, () => ({
        packageName: randomString(rng, 12) || 'x',
        importType: (rng() < 0.3 ? 'type-only' : 'runtime') as 'runtime' | 'type-only',
        file: 'src/fake.ts',
        line: 1,
        importStatement: 'import x',
      }));

      const result = analyzeDependencies(pkg, imports, {
        checkAll: rng() < 0.5,
        checkPeer: rng() < 0.5,
        ignoredPackages: [],
      });

      expect(Array.isArray(result.unused)).toBe(true);
      expect(Array.isArray(result.unusedPeer)).toBe(true);
      expect(Array.isArray(result.misplaced)).toBe(true);
      expect(Array.isArray(result.typeOnly)).toBe(true);
      expect(typeof result.totalIssues).toBe('number');
      expect(result.totalIssues).toBe(result.unused.length + result.unusedPeer.length + result.misplaced.length + result.typeOnly.length);
    }
  });
});

describe('chaos: file-reader on random file contents', () => {
  beforeAll(async () => {
    await mkdir(FIXTURE_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(FIXTURE_DIR, { recursive: true, force: true });
  });

  const rng = makeRng(0xfeedface);

  test('readFile + readJSONFile do not throw on random byte content', async () => {
    const fileCount = 50;
    const paths = Array.from({ length: fileCount }, (_, i) => `${FIXTURE_DIR}/fuzz-${i}.bin`);
    await Promise.all(paths.map((p) => writeFile(p, randomString(rng, 256))));

    // 호출이 throw하면 테스트는 실패한다. 결과 discriminant은 타입으로 보장됨.
    let touched = 0;
    for (const filePath of paths) {
      readFile(filePath);
      readJSONFile(filePath);
      touched++;
    }
    expect(touched).toBe(fileCount);
  });

  test('readPackageJson tolerates pathological JSON without throwing', async () => {
    const cases = [
      '{}',
      '[]',
      'null',
      '0',
      '"x"',
      '{"name": null}',
      '{"dependencies": "not-an-object"}',
      '{"dependencies": []}',
      '{"dependencies": {"a": 1, "b": null}}',
    ];
    const paths = cases.map((_, i) => `${FIXTURE_DIR}/edge-${i}.json`);
    await Promise.all(paths.map((p, i) => writeFile(p, cases[i] as string)));

    for (const filePath of paths) {
      readPackageJson(filePath);
    }
    expect(paths.length).toBe(cases.length);
  });

  test('parseFile on random non-source files returns well-formed Result without throwing', async () => {
    const fileCount = 30;
    const paths = Array.from({ length: fileCount }, (_, i) => `${FIXTURE_DIR}/source-${i}.ts`);
    await Promise.all(paths.map((p) => writeFile(p, randomImportLikeContent(rng))));

    for (const filePath of paths) {
      const result = parseFile(filePath);
      if (R.isOk(result)) {
        expect(Array.isArray(R.getExn(result))).toBe(true);
      }
    }
  });
});
