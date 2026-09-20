// backend/src/aiworker/concurrency.ts
// 직접 만든 동시성 제한 함수 (p-limit 등 외부 의존 금지).
// items 를 최대 limit 개씩 병렬로 fn 에 태워 결과를 입력 순서대로 반환.

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const max = Math.max(1, Math.floor(limit));
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(max, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
