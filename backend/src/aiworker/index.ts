// backend/src/aiworker/index.ts
// ai-worker Lambda 엔트리. 비동기. 직접호출 + SQS 이벤트 모두 처리.
// payload의 job.kind 로 분기(keywords/questions/generate). 핸들러 export 이름은 handler.

import { createDynamoStore } from '../lib/db.js';
import { parseJobEvent, type JobPayload } from '../lib/dispatch.js';
import { runJob, addEvent, lowOnTime, type LambdaContextLike } from '../lib/jobs.js';
import { putSiteHtml } from '../lib/s3.js';
import { runKeywords } from './keywords.js';
import { runQuestions } from './questions.js';
import { runGenerate } from './generate.js';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`환경 변수 ${name} 가 설정되지 않았습니다`);
  return v;
}
function num(name: string, def: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : def;
}

export async function handler(event: unknown, context?: LambdaContextLike): Promise<void> {
  const tableName = env('TABLE_NAME');
  const bucket = env('SITE_BUCKET');
  const modelId = env('BEDROCK_MODEL_ID');
  const concurrency = num('AI_CONCURRENCY', 3);
  const sitePublicBase = process.env.SITE_PUBLIC_BASE || undefined;
  const apiPublicBase = env('API_PUBLIC_BASE');

  const store = createDynamoStore(tableName);
  const payloads = parseJobEvent(event);

  for (const p of payloads) {
    await handleOne(p);
  }

  async function handleOne(p: JobPayload): Promise<void> {
    if (p.kind !== 'keywords' && p.kind !== 'questions' && p.kind !== 'generate') return;
    await runJob(store, p.sessionId, p.jobId, async () => {
      if (lowOnTime(context)) {
        await addEvent(store, p.sessionId, p.jobId, '시간 제한으로 일부만 처리했습니다.');
        return;
      }
      const onEvent = (m: string) => addEvent(store, p.sessionId, p.jobId, m);
      if (p.kind === 'keywords') {
        await runKeywords({ store, sessionId: p.sessionId, modelId, concurrency, onEvent });
      } else if (p.kind === 'questions') {
        await runQuestions({ store, sessionId: p.sessionId, modelId, onEvent });
      } else {
        await runGenerate({
          store,
          sessionId: p.sessionId,
          modelId,
          bucket,
          sitePublicBase,
          apiPublicBase,
          onEvent,
          uploadHtml: (sid, html) => putSiteHtml(bucket, sid, html),
        });
      }
    });
  }
}
