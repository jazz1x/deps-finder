/**
 * 결정적(deterministic) PRNG — 시드를 고정하면 같은 시퀀스가 나온다.
 * mulberry32: 빠르고 통계적 품질이 충분한 32-bit hash-mixing PRNG.
 *
 * 테스트와 벤치마크에서만 사용. 프로덕션 RNG 용도가 아니다.
 */
export const makeRng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
