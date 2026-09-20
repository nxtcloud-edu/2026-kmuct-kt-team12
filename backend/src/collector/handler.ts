// backend/src/collector/handler.ts
// Collector Lambda 엔트리포인트. CollectJob(비동기 이벤트)을 받아 수집을 수행한다.
// 수집이 끝나면 runCollect 가 pipeline 단계를 비동기로 invoke 한다.

import type { CollectJob } from '../ports.js';
import { runCollect, type CollectorDeps } from '../worker/worker.js';

/** 순수 핸들러: 테스트에서 CollectorDeps 를 주입해 직접 부른다. */
export async function handleCollect(job: CollectJob, deps: CollectorDeps): Promise<void> {
    await runCollect({ portfolioId: job.portfolioId, runId: job.runId, mode: job.mode }, deps);
}

// ── AWS Lambda 엔트리(자격증명·SDK 연결 후 활성화) ────────────────
// export const handler = async (event: CollectJob) => {
//   const deps = await buildCollectorDeps();  // DynamoStore, S3Blob, FetchHttp, LambdaJobInvoker...
//   await handleCollect(event, deps);
// };
