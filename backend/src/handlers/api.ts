// backend/src/handlers/api.ts
// API Lambda 진입점. API Gateway HTTP API 이벤트를 받아 api.ts 라우터로 전달.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoStore } from '../adapters/aws/dynamo-store.js';
import { S3Blob } from '../adapters/aws/s3-blob.js';
import { BedrockConverse } from '../adapters/aws/bedrock.js';
import { FetchHttp } from '../adapters/aws/fetch-http.js';
import { LambdaJobInvoker } from '../adapters/aws/lambda-invoker.js';
import { handle, type ApiDeps } from '../api/api.js';
import { systemClock, uuidIdGen } from '../util.js';

const store = new DynamoStore(process.env.TABLE_NAME!);
const blob = new S3Blob(process.env.BUCKET_NAME!);
const bedrock = new BedrockConverse(process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-sonnet-4-20250514-v1:0');
const http = new FetchHttp();
const jobs = new LambdaJobInvoker(
    process.env.COLLECTOR_FN_NAME!,
    process.env.PIPELINE_FN_NAME!,
);

const deps: ApiDeps = {
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

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    let body: unknown = undefined;
    if (event.body) {
        try {
            body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body);
        } catch {
            body = undefined;
        }
    }

    const res = await handle({ method, path, body }, deps);

    return {
        statusCode: res.status,
        headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
            'access-control-allow-headers': 'content-type',
        },
        body: res.body !== undefined ? JSON.stringify(res.body) : '',
    };
}
