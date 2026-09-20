// backend/src/api/index.ts
// api Lambda 엔트리. 동기, HTTP API payload v2.
// OPTIONS preflight 처리 + 모든 응답에 CORS 헤더 추가.
// 핸들러 export 이름은 handler.

import { buildRouter } from './routes.js';
import { configFromEnv } from '../lib/dispatch.js';
import { createDynamoStore } from '../lib/db.js';
import { readSiteHtml } from '../lib/s3.js';
import type { ApiEvent, ApiResult } from './router.js';

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
};

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`환경 변수 ${name} 가 설정되지 않았습니다`);
  return v;
}

let cachedRouter: ReturnType<typeof buildRouter> | null = null;

function getRouter() {
  if (cachedRouter) return cachedRouter;
  const tableName = env('TABLE_NAME');
  const bucket = env('SITE_BUCKET');
  const store = createDynamoStore(tableName);
  cachedRouter = buildRouter({
    store,
    dispatchConfig: configFromEnv(),
    siteReader: { readSiteHtml: (sessionId) => readSiteHtml(bucket, sessionId) },
  });
  return cachedRouter;
}

export async function handler(event: ApiEvent): Promise<ApiResult> {
  const method = event.requestContext?.http?.method ?? 'GET';

  // CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  const router = getRouter();
  const result = await router.handle(event);

  // 모든 응답에 CORS 헤더 추가
  result.headers = { ...result.headers, ...CORS_HEADERS };
  return result;
}
