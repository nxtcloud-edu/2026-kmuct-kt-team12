// backend/src/lib/jobs.ts
// Job 생성/이벤트/상태 헬퍼 + 작업 Lambda 공통 안정성 래퍼.

import type { Job, JobKind } from '../types.js';
import { type Store, pk, SK, itemToJob } from './db.js';

// jobId = "{sessionId}.{랜덤}"
export function makeJobId(sessionId: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${sessionId}.${rand}`;
}

// GET /jobs/{jobId} 에서 마지막 점 앞부분으로 sessionId 역산
export function sessionIdOfJob(jobId: string): string {
  const idx = jobId.lastIndexOf('.');
  return idx === -1 ? jobId : jobId.slice(0, idx);
}

export async function createJob(
  store: Store,
  sessionId: string,
  kind: JobKind,
  firstMessage: string,
): Promise<Job> {
  const job: Job = {
    id: makeJobId(sessionId),
    sessionId,
    kind,
    status: 'running',
    events: [{ at: new Date().toISOString(), message: firstMessage }],
  };
  await store.put({ PK: pk(sessionId), SK: SK.job(job.id), ...job });
  return job;
}

export async function getJob(store: Store, sessionId: string, jobId: string): Promise<Job | undefined> {
  const it = await store.get(pk(sessionId), SK.job(jobId));
  return it ? itemToJob(it) : undefined;
}

export async function hasRunningJob(store: Store, sessionId: string): Promise<boolean> {
  const items = await store.queryByPrefix(pk(sessionId), 'JOB#');
  return items.some((it) => (it as { status?: string }).status === 'running');
}

export async function addEvent(
  store: Store,
  sessionId: string,
  jobId: string,
  message: string,
): Promise<void> {
  await store.appendJobEvents(pk(sessionId), SK.job(jobId), [
    { at: new Date().toISOString(), message },
  ]);
}

export async function setStatus(
  store: Store,
  sessionId: string,
  jobId: string,
  status: Job['status'],
): Promise<void> {
  await store.update(pk(sessionId), SK.job(jobId), { status });
}

// 남은 시간이 30초 미만인지
export interface LambdaContextLike {
  getRemainingTimeInMillis(): number;
}
export function lowOnTime(ctx?: LambdaContextLike): boolean {
  if (!ctx) return false;
  return ctx.getRemainingTimeInMillis() < 30_000;
}

// 작업 Lambda 공통 래퍼:
// - startedAt 조건부 쓰기로 중복 실행 방지 (실패 시 즉시 정상 종료)
// - 예외를 모두 잡아 failed 처리 + 한국어 사유 event 후 정상 종료 (throw 금지)
export async function runJob(
  store: Store,
  sessionId: string,
  jobId: string,
  work: () => Promise<void>,
): Promise<void> {
  let started: boolean;
  try {
    started = await store.markStarted(pk(sessionId), SK.job(jobId));
  } catch (e) {
    // Job 항목이 없거나 markStarted 자체가 실패하면 조용히 종료(재시도 폭주 방지)
    console.error('markStarted 실패 (무시):', (e as Error).message);
    return;
  }
  if (!started) {
    // 이미 실행 중/완료 — 중복 호출. 정상 종료.
    return;
  }

  try {
    await work();
    await setStatus(store, sessionId, jobId, 'done');
  } catch (e) {
    const reason = koreanReason(e);
    try {
      await addEvent(store, sessionId, jobId, `실패했습니다: ${reason}`);
      await setStatus(store, sessionId, jobId, 'failed');
    } catch (inner) {
      console.error('failed 처리 중 오류:', (inner as Error).message);
    }
    // 예외를 밖으로 던지지 않는다 (자동 재시도 방지)
  }
}

function koreanReason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // 토큰/본문 같은 민감정보가 메시지에 섞였을 수 있으므로 길이 제한
  return msg.length > 200 ? msg.slice(0, 200) : msg;
}
