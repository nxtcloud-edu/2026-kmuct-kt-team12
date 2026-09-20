// backend/src/api/handler.ts
// API Lambda 엔트리포인트. API Gateway HTTP API 이벤트를 ApiRequest 로 바꿔 handle() 에 넘긴다.

import { handle, type ApiDeps, type ApiRequest, type ApiResponse } from './api.js';

/** API Gateway HTTP API(v2) 이벤트의 최소 형태. */
export interface ApiGatewayEvent {
    requestContext: { http: { method: string; path: string } };
    rawPath?: string;
    body?: string | null;
}
export interface ApiGatewayResult {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
}

function toRequest(event: ApiGatewayEvent): ApiRequest {
    const method = event.requestContext.http.method;
    const path = event.rawPath ?? event.requestContext.http.path;
    let body: unknown;
    if (event.body) {
        try {
            body = JSON.parse(event.body);
        } catch {
            body = undefined;
        }
    }
    return { method, path, body };
}

function toResult(res: ApiResponse): ApiGatewayResult {
    return {
        statusCode: res.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: res.body === undefined ? '' : JSON.stringify(res.body),
    };
}

/** 순수 핸들러: 테스트에서 ApiDeps 를 주입해 직접 부른다. */
export async function handleApiEvent(event: ApiGatewayEvent, deps: ApiDeps): Promise<ApiGatewayResult> {
    const res = await handle(toRequest(event), deps);
    return toResult(res);
}

// ── AWS Lambda 엔트리(자격증명·SDK 연결 후 활성화) ────────────────
// export const handler = async (event: ApiGatewayEvent) => {
//   const deps = await buildApiDeps();  // DynamoStore, S3Blob, LambdaJobInvoker(Collector/Pipeline)...
//   return handleApiEvent(event, deps);
// };
