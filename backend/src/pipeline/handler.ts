// backend/src/pipeline/handler.ts
// Pipeline Lambda 엔트리포인트. pipeline(추출~마스터) 과 tailor(직무 맞춤) 두 Job 을 처리한다.
// (tailor 는 수집이 필요 없어 API 가 이 Lambda 를 바로 부른다.)

import type { PipelineJob, TailorJob, Deps } from '../ports.js';
import { runPipeline, runTailor } from '../worker/worker.js';

/** 순수 핸들러: 테스트에서 Deps 를 주입해 직접 부른다. */
export async function handlePipeline(job: PipelineJob | TailorJob, deps: Deps): Promise<void> {
    if (job.kind === 'pipeline') {
        await runPipeline({ portfolioId: job.portfolioId, runId: job.runId, mode: job.mode }, deps);
    } else {
        await runTailor(
            {
                portfolioId: job.portfolioId,
                runId: job.runId,
                targetRole: job.targetRole,
                jdText: job.jdText,
                selectedActivityIds: job.selectedActivityIds,
            },
            deps,
        );
    }
}

// ── AWS Lambda 엔트리(자격증명·SDK 연결 후 활성화) ────────────────
// export const handler = async (event: PipelineJob | TailorJob) => {
//   const deps = await buildPipelineDeps();  // DynamoStore, S3Blob, BedrockConverse...
//   await handlePipeline(event, deps);
// };
