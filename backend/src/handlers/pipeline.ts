// backend/src/handlers/pipeline.ts
// Pipeline Lambda 진입점. Collector 또는 API 가 비동기 invoke 로 호출.
// kind 에 따라 runPipeline 또는 runTailor 를 실행.

import { DynamoStore } from '../adapters/aws/dynamo-store.js';
import { S3Blob } from '../adapters/aws/s3-blob.js';
import { BedrockConverse } from '../adapters/aws/bedrock.js';
import { FetchHttp } from '../adapters/aws/fetch-http.js';
import { runPipeline, runTailor } from '../worker/worker.js';
import { systemClock, uuidIdGen } from '../util.js';
import type { Deps, PipelineJob, TailorJob } from '../ports.js';

const store = new DynamoStore(process.env.TABLE_NAME!);
const blob = new S3Blob(process.env.BUCKET_NAME!);
const bedrock = new BedrockConverse(process.env.BEDROCK_MODEL_ID!);
const http = new FetchHttp();

const deps: Deps = {
    store,
    blob,
    bedrock,
    http,
    clock: systemClock,
    id: uuidIdGen,
    env: {
        EXTRACT_CONCURRENCY: Number(process.env.EXTRACT_CONCURRENCY ?? '3'),
        BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID!,
        GITHUB_TOKEN: process.env.GITHUB_TOKEN,
        NOTION_TOKEN: process.env.NOTION_TOKEN,
        TISTORY_TOKEN: process.env.TISTORY_TOKEN,
        RAWTEXT_SPILL_LIMIT: Number(process.env.RAWTEXT_SPILL_LIMIT ?? '40000'),
    },
};

export async function handler(event: PipelineJob | TailorJob): Promise<void> {
    if (event.kind === 'pipeline') {
        await runPipeline(
            { portfolioId: event.portfolioId, runId: event.runId, mode: event.mode },
            deps,
        );
    } else if (event.kind === 'tailor') {
        await runTailor(
            {
                portfolioId: event.portfolioId,
                runId: event.runId,
                targetRole: event.targetRole,
                jdText: event.jdText,
                selectedActivityIds: event.selectedActivityIds,
            },
            deps,
        );
    }
}
