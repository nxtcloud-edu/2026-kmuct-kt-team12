// backend/src/handlers/collector.ts
// Collector Lambda 진입점. API Lambda 가 비동기 invoke 로 호출.

import { DynamoStore } from '../adapters/aws/dynamo-store.js';
import { S3Blob } from '../adapters/aws/s3-blob.js';
import { BedrockConverse } from '../adapters/aws/bedrock.js';
import { FetchHttp } from '../adapters/aws/fetch-http.js';
import { LambdaJobInvoker } from '../adapters/aws/lambda-invoker.js';
import { runCollect, type CollectorDeps } from '../worker/worker.js';
import { systemClock, uuidIdGen } from '../util.js';
import type { CollectJob } from '../ports.js';

const store = new DynamoStore(process.env.TABLE_NAME!);
const blob = new S3Blob(process.env.BUCKET_NAME!);
const bedrock = new BedrockConverse(process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-sonnet-4-20250514-v1:0');
const http = new FetchHttp();
const jobs = new LambdaJobInvoker(
    '', // collector 는 자기 자신을 호출하지 않음
    process.env.PIPELINE_FN_NAME!,
);

const deps: CollectorDeps = {
    store,
    blob,
    bedrock,
    http,
    clock: systemClock,
    id: uuidIdGen,
    jobs,
    env: {
        EXTRACT_CONCURRENCY: Number(process.env.EXTRACT_CONCURRENCY ?? '3'),
        BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-sonnet-4-20250514-v1:0',
        GITHUB_TOKEN: process.env.GITHUB_TOKEN,
        NOTION_TOKEN: process.env.NOTION_TOKEN,
        TISTORY_TOKEN: process.env.TISTORY_TOKEN,
        RAWTEXT_SPILL_LIMIT: Number(process.env.RAWTEXT_SPILL_LIMIT ?? '40000'),
    },
};

export async function handler(event: CollectJob): Promise<void> {
    await runCollect(
        { portfolioId: event.portfolioId, runId: event.runId, mode: event.mode },
        deps,
    );
}
