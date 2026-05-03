/**
 * import-parser 마이크로벤치마크
 *
 * - hot path (extractImports)에 대한 회귀 가드
 * - `bun run bench`로 실행
 * - 파일별/import-수별로 측정해서 sub-linear 특성을 확인
 *
 * 결정적: 시드 고정 PRNG + 고정 입력 크기.
 */

import { extractImports, isBuiltinModule } from '../src/parsers/import-parser.ts';
import { makeRng } from '../src/test-utils/random.ts';

/**
 * 고정 시드로 합성 소스 파일 생성.
 * @param lines 총 라인 수
 * @param importDensity 0~1 (0.1 = 10%가 import 라인)
 */
const synthSource = (lines: number, importDensity: number, seed = 0xc0ffee): string => {
  const rng = makeRng(seed);
  const pkgs = [
    'react',
    'react-dom',
    '@mobily/ts-belt',
    'lodash',
    'lodash/fp',
    'next/image',
    '@radix-ui/react-dialog',
    'date-fns',
    'rxjs/operators',
    'fs', // builtin (필터링됨)
    'node:path', // builtin
    'bun:test', // builtin
    'express',
    '@types/node',
    'typescript',
  ];
  const out: string[] = [];
  for (let i = 0; i < lines; i++) {
    if (rng() < importDensity) {
      const pkg = pkgs[Math.floor(rng() * pkgs.length)];
      const flavor = Math.floor(rng() * 4);
      if (flavor === 0) out.push(`import x${i} from '${pkg}';`);
      else if (flavor === 1) out.push(`import { a, b } from "${pkg}";`);
      else if (flavor === 2) out.push(`const m${i} = require('${pkg}');`);
      else out.push(`import type T${i} from '${pkg}';`);
    } else {
      out.push(`const v${i} = ${i};`);
    }
  }
  return out.join('\n');
};

const fmtNs = (ns: number): string => {
  if (ns < 1_000) return `${ns.toFixed(0)}ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)}µs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)}ms`;
  return `${(ns / 1_000_000_000).toFixed(3)}s`;
};

const bench = (label: string, iterations: number, fn: () => void): void => {
  // warmup: 작업당 비용이 큰 케이스에서 정밀도엔 영향 없으면서 시작 오버헤드는 줄어들도록
  // iter의 ~10%만 (최소 5, 최대 50) 돌린다. 큰 입력 벤치의 워밍업 비용이 본 측정만큼 커지지 않음.
  const warmupRuns = Math.min(50, Math.max(5, Math.floor(iterations / 10)));
  for (let i = 0; i < warmupRuns; i++) fn();

  const t0 = Bun.nanoseconds();
  for (let i = 0; i < iterations; i++) fn();
  const t1 = Bun.nanoseconds();

  const total = t1 - t0;
  const perOp = total / iterations;
  console.log(
    `  ${label.padEnd(48)} ${fmtNs(perOp).padStart(10)} / op   (${iterations} iters, total ${fmtNs(total)})`,
  );
};

console.log('\n== extractImports — file-size scaling ==');
for (const lines of [100, 1_000, 10_000]) {
  const source = synthSource(lines, 0.1);
  const importCount = extractImports(source, 'fixture.ts').length;
  bench(`${lines.toString().padStart(6)} lines (${importCount} imports)`, 200, () => {
    extractImports(source, 'fixture.ts');
  });
}

console.log('\n== extractImports — import-density scaling (1000 lines) ==');
for (const density of [0.05, 0.2, 0.5, 1.0]) {
  const source = synthSource(1_000, density);
  const importCount = extractImports(source, 'fixture.ts').length;
  bench(
    `density ${(density * 100).toFixed(0).padStart(3)}% (${importCount} imports)`,
    200,
    () => {
      extractImports(source, 'fixture.ts');
    },
  );
}

console.log('\n== isBuiltinModule — hot lookup ==');
const builtinSamples = ['fs', 'node:path', 'bun:test', 'react', 'lodash', 'unknown-pkg'];
bench('isBuiltinModule x6 (mixed hit/miss)', 100_000, () => {
  for (const s of builtinSamples) isBuiltinModule(s);
});
