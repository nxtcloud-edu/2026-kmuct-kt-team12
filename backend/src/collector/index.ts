// backend/src/collector/index.ts
// collector Lambda 엔트리. 비동기. 직접호출 이벤트 + SQS 이벤트 모두 처리.
// 핸들러 export 이름은 handler.

import { createDynamoStore } from '../lib/db.js';
import { parseJobEvent, type JobPayload } from '../lib/dispatch.js';
import { runJob, addEvent, lowOnTime, type LambdaContextLike } from '../lib/jobs.js';
import { runCollect } from './collect.js';

function num(name: string, def: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : def;
}

export async function handler(event: unknown, context?: LambdaContextLike): Promise<void> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) throw new Error('환경 변수 TABLE_NAME 가 설정되지 않았습니다');
  const store = createDynamoStore(tableName);
  const limits = {
    maxRepos: num('MAX_REPOS', 20),
    maxPosts: num('MAX_POSTS', 20),
    maxPages: num('MAX_PAGES', 20),
  };

  const payloads = parseJobEvent(event);
  for (const p of payloads) {
    await handleOne(store, p, limits, context);
  }
}

async function handleOne(
  store: ReturnType<typeof createDynamoStore>,
  p: JobPayload,
  limits: { maxRepos: number; maxPosts: number; maxPages: number },
  context?: LambdaContextLike,
): Promise<void> {
  if (p.kind !== 'collect') return;
  await runJob(store, p.sessionId, p.jobId, async () => {
    if (lowOnTime(context)) {
      await addEvent(store, p.sessionId, p.jobId, '시간 제한으로 일부만 처리했습니다.');
      return;
    }
    await runCollect({
      store,
      sessionId: p.sessionId,
      connections: p.connections ?? {},
      limits,
      onEvent: (message) => addEvent(store, p.sessionId, p.jobId, message),
    });
  });
}
