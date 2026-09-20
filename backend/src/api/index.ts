// backend/src/api/index.ts
// api Lambda 엔트리. 동기, HTTP API payload v2. CORS 헤더는 넣지 않는다(API Gateway 설정).
// 핸들러 export 이름은 handler.

import { buildRouter } from './routes.js';
import { configFromEnv } from '../lib/dispatch.js';
import { createDynamoStore } from '../lib/db.js';
import { readSiteHtml } from '../lib/s3.js';
import type { ApiEvent, ApiResult } from './router.js';

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
  const router = getRouter();
  return router.handle(event);
}
