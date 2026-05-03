/**
 * Line index — 파일 내용을 한 번 스캔해 각 라인의 시작 인덱스 배열을 만들고,
 * 이를 이진 탐색해 임의 byte offset이 속한 1-based 줄 번호를 O(log L)로 찾는다.
 *
 * tsc / swc / biome / oxc 등 모든 컴파일러·린터가 쓰는 정통 패턴.
 * substring + split('\n') 기반 O(L) 룩업의 대체용.
 */

/**
 * 한 번의 패스로 줄 시작 인덱스를 만든다 — O(L), 메모리 O(라인 수).
 * `lineStarts[0]` 은 항상 0 (1번째 줄 시작),
 * `lineStarts[i]` 는 (i+1)번째 줄의 시작 인덱스.
 */
export const buildLineStarts = (content: string): readonly number[] => {
  const starts: number[] = [0];
  const len = content.length;
  for (let i = 0; i < len; i++) {
    // charCodeAt이 substring/indexOf 루프보다 빠르고 GC 압력 없음
    if (content.charCodeAt(i) === 0x0a /* \n */) {
      starts.push(i + 1);
    }
  }
  return starts;
};

/**
 * lineStarts 안에서 offset이 속한 1-based 줄 번호를 이진 탐색으로 반환 — O(log L).
 *
 * lineStarts[i] <= offset 인 가장 큰 i를 찾고, 1-based 줄 번호는 (i + 1).
 * 즉 upper_bound - 1 패턴.
 */
export const lineNumberAt = (lineStarts: readonly number[], offset: number): number => {
  let lo = 0;
  let hi = lineStarts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    // lineStarts[mid]는 정의상 항상 존재 (lo < hi <= length)
    if ((lineStarts[mid] as number) <= offset) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  // lo === upper_bound. 1-based 줄 번호 == upper_bound (lineStarts가 1-line=0 인덱스부터 시작하므로).
  return lo;
};
