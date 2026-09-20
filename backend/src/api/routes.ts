// backend/src/api/routes.ts
// 명세 7장 전체 경로를 라우터에 등록. 의존성(store, dispatch, s3 getter, verify)은 주입.

import { randomUUID } from 'node:crypto';
import { Router, ApiError, json, type ApiResult, type ReqContext } from './router.js';
import type { Store } from '../lib/db.js';
import {
  pk,
  SK,
  getRecords,
  getKeywords,
  getExperiences,
  getQuestions,
} from '../lib/db.js';
import {
  createJob,
  getJob,
  hasRunningJob,
  sessionIdOfJob,
} from '../lib/jobs.js';
import { dispatchJob, type JobPayload, type DispatchConfig } from '../lib/dispatch.js';
import type { JobKind, Connections, RecordItem, Question, SiteInfo } from '../types.js';
import { verifyConnections, type VerifyResult } from './verify.js';

export interface SiteReader {
  // S3 sites/{sessionId}/index.html 을 읽어 HTML 문자열 반환. 없으면 undefined.
  readSiteHtml(sessionId: string): Promise<string | undefined>;
}

export interface ApiDeps {
  store: Store;
  dispatchConfig: DispatchConfig;
  siteReader: SiteReader;
  // 테스트 주입용 (기본은 실제 dispatch/verify)
  dispatch?: (payload: JobPayload) => Promise<void>;
  verify?: (conn: Connections) => Promise<VerifyResult>;
}

const VALID_KINDS: JobKind[] = ['collect', 'keywords', 'questions', 'generate'];

// 세션 존재 확인 (META 항목)
async function ensureSession(store: Store, sessionId: string): Promise<void> {
  const meta = await store.get(pk(sessionId), SK.meta());
  if (!meta) throw new ApiError(404, 'session_not_found', '세션을 찾을 수 없습니다.');
}

// kind별 선행 조건 검사. 미충족이면 409.
async function checkPrecondition(store: Store, sessionId: string, kind: JobKind): Promise<void> {
  if (kind === 'keywords') {
    const recs = await getRecords(store, sessionId);
    if (!recs.some((r) => !r.excluded)) {
      throw new ApiError(409, 'precondition', '제외되지 않은 기록이 최소 1개 필요합니다. 먼저 기록을 수집하세요.');
    }
  } else if (kind === 'questions') {
    const kws = await getKeywords(store, sessionId);
    if (kws.length === 0) {
      throw new ApiError(409, 'precondition', '키워드가 최소 1개 필요합니다. 먼저 키워드를 정리하세요.');
    }
  } else if (kind === 'generate') {
    const exps = await getExperiences(store, sessionId);
    if (exps.length === 0) {
      throw new ApiError(409, 'precondition', '경험이 최소 1개 필요합니다. 먼저 경험을 확인하세요.');
    }
  }
  // collect 는 선행 조건 없음
}

export function buildRouter(deps: ApiDeps): Router {
  const { store } = deps;
  const doDispatch =
    deps.dispatch ??
    ((payload: JobPayload) => dispatchJob(payload, { config: deps.dispatchConfig }));
  const doVerify = deps.verify ?? ((conn: Connections) => verifyConnections(conn));

  const r = new Router();

  // POST /sessions → 201 { sessionId }
  r.post('/sessions', async (): Promise<ApiResult> => {
    const sessionId = randomUUID();
    await store.put({
      PK: pk(sessionId),
      SK: SK.meta(),
      sessionId,
      createdAt: new Date().toISOString(),
    });
    return json(201, { sessionId });
  });

  // POST /sessions/{id}/connections/verify
  r.post('/sessions/:id/connections/verify', async (ctx: ReqContext): Promise<ApiResult> => {
    await ensureSession(store, ctx.params.id);
    const conn = (ctx.json<Connections>() ?? {}) as Connections;
    const result = await doVerify(conn);
    return json(200, result);
  });

  // POST /sessions/{id}/jobs → 202 { jobId }
  r.post('/sessions/:id/jobs', async (ctx: ReqContext): Promise<ApiResult> => {
    const sessionId = ctx.params.id;
    await ensureSession(store, sessionId);
    const body = ctx.json<{ kind?: JobKind; connections?: Connections }>() ?? {};
    const kind = body.kind;
    if (!kind || !VALID_KINDS.includes(kind)) {
      throw new ApiError(400, 'bad_kind', '작업 종류(kind)가 올바르지 않습니다.');
    }
    if (await hasRunningJob(store, sessionId)) {
      throw new ApiError(409, 'job_running', '이미 진행 중인 작업이 있습니다. 완료 후 다시 시도하세요.');
    }
    await checkPrecondition(store, sessionId, kind);

    const first =
      kind === 'collect'
        ? '수집을 시작합니다.'
        : kind === 'keywords'
          ? '키워드 분석을 시작합니다.'
          : kind === 'questions'
            ? '확인 질문을 준비합니다.'
            : '포트폴리오 생성을 시작합니다.';
    const job = await createJob(store, sessionId, kind, first);

    const payload: JobPayload = {
      sessionId,
      jobId: job.id,
      kind,
      ...(kind === 'collect' && body.connections ? { connections: body.connections } : {}),
    };
    await doDispatch(payload);
    return json(202, { jobId: job.id });
  });

  // GET /jobs/{jobId} → Job
  r.get('/jobs/:jobId', async (ctx: ReqContext): Promise<ApiResult> => {
    const jobId = ctx.params.jobId;
    const sessionId = sessionIdOfJob(jobId);
    const job = await getJob(store, sessionId, jobId);
    if (!job) throw new ApiError(404, 'job_not_found', '작업을 찾을 수 없습니다.');
    return json(200, job);
  });

  // GET /sessions/{id}/records → RecordItem[] (timeStart 내림차순, 없으면 맨 뒤)
  r.get('/sessions/:id/records', async (ctx: ReqContext): Promise<ApiResult> => {
    await ensureSession(store, ctx.params.id);
    const recs = await getRecords(store, ctx.params.id);
    recs.sort(compareByTimeStartDesc);
    return json(200, recs);
  });

  // PATCH /sessions/{id}/records/{recordId} → RecordItem
  r.patch('/sessions/:id/records/:recordId', async (ctx: ReqContext): Promise<ApiResult> => {
    const sessionId = ctx.params.id;
    await ensureSession(store, sessionId);
    const body = ctx.json<{ excluded?: boolean }>() ?? {};
    if (typeof body.excluded !== 'boolean') {
      throw new ApiError(400, 'bad_body', 'excluded(boolean) 값이 필요합니다.');
    }
    const it = await store.get(pk(sessionId), SK.rec(ctx.params.recordId));
    if (!it) throw new ApiError(404, 'record_not_found', '기록을 찾을 수 없습니다.');
    const rec = { ...(it as unknown as RecordItem), excluded: body.excluded };
    // 사용자 수동 변경 시 자동 제외 사유는 지운다
    if (!body.excluded) delete rec.excludedReason;
    await store.put({ PK: pk(sessionId), SK: SK.rec(rec.id), ...rec });
    return json(200, rec);
  });

  // GET /sessions/{id}/keywords → { keywords, experiences }
  r.get('/sessions/:id/keywords', async (ctx: ReqContext): Promise<ApiResult> => {
    await ensureSession(store, ctx.params.id);
    const [keywords, experiences] = await Promise.all([
      getKeywords(store, ctx.params.id),
      getExperiences(store, ctx.params.id),
    ]);
    return json(200, { keywords, experiences });
  });

  // GET /sessions/{id}/questions → Question[]
  r.get('/sessions/:id/questions', async (ctx: ReqContext): Promise<ApiResult> => {
    await ensureSession(store, ctx.params.id);
    const qs = await getQuestions(store, ctx.params.id);
    return json(200, qs);
  });

  // POST /sessions/{id}/questions/{qid}/answer → Question  (AI 호출 없음)
  r.post('/sessions/:id/questions/:qid/answer', async (ctx: ReqContext): Promise<ApiResult> => {
    const sessionId = ctx.params.id;
    await ensureSession(store, sessionId);
    const body = ctx.json<{ answer?: 'yes' | 'no' | 'skip'; detail?: string }>() ?? {};
    const map: Record<string, Question['status']> = { yes: 'yes', no: 'no', skip: 'skipped' };
    const status = body.answer ? map[body.answer] : undefined;
    if (!status) {
      throw new ApiError(400, 'bad_answer', "answer는 'yes'|'no'|'skip' 중 하나여야 합니다.");
    }
    const it = await store.get(pk(sessionId), SK.q(ctx.params.qid));
    if (!it) throw new ApiError(404, 'question_not_found', '질문을 찾을 수 없습니다.');
    const q = it as unknown as Question;
    q.status = status;
    if (status === 'yes' && typeof body.detail === 'string' && body.detail.trim()) {
      q.detail = body.detail.trim().slice(0, 200);
    } else {
      delete q.detail;
    }
    await store.put({ PK: pk(sessionId), SK: SK.q(q.id), ...q });
    return json(200, q);
  });

  // GET /sessions/{id}/site → SiteInfo | 404
  r.get('/sessions/:id/site', async (ctx: ReqContext): Promise<ApiResult> => {
    await ensureSession(store, ctx.params.id);
    const it = await store.get(pk(ctx.params.id), SK.site());
    if (!it) throw new ApiError(404, 'site_not_found', '아직 생성된 사이트가 없습니다.');
    const { PK: _p, SK: _s, ...site } = it;
    return json(200, site as unknown as SiteInfo);
  });

  // GET /sites/{sessionId} → HTML (JSON 아님)
  r.get('/sites/:sessionId', async (ctx: ReqContext): Promise<ApiResult> => {
    const html = await deps.siteReader.readSiteHtml(ctx.params.sessionId);
    if (html === undefined) {
      return {
        statusCode: 404,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '<!doctype html><meta charset="utf-8"><title>없음</title><p>사이트를 찾을 수 없습니다.</p>',
      };
    }
    return {
      statusCode: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: html,
    };
  });

  return r;
}

// timeStart 내림차순. 없으면 맨 뒤.
export function compareByTimeStartDesc(a: RecordItem, b: RecordItem): number {
  const at = a.timeStart;
  const bt = b.timeStart;
  if (!at && !bt) return 0;
  if (!at) return 1;
  if (!bt) return -1;
  return at < bt ? 1 : at > bt ? -1 : 0;
}
