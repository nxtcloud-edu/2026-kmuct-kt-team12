import { describe, it, expect, vi } from 'vitest';
import { buildRouter, compareByTimeStartDesc, type ApiDeps } from './routes.js';
import { Router } from './router.js';
import { MemoryStore, pk, SK } from '../lib/db.js';
import { verifyConnections, normalizeTistoryUrl } from './verify.js';
import type { ApiEvent } from './router.js';
import type { JobPayload } from '../lib/dispatch.js';
import type { RecordItem } from '../types.js';

function ev(method: string, path: string, body?: unknown, query = ''): ApiEvent {
  return {
    requestContext: { http: { method } },
    rawPath: path,
    rawQueryString: query,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function makeDeps(overrides: Partial<ApiDeps> = {}): {
  deps: ApiDeps;
  store: MemoryStore;
  dispatched: JobPayload[];
} {
  const store = new MemoryStore();
  const dispatched: JobPayload[] = [];
  const deps: ApiDeps = {
    store,
    dispatchConfig: { mode: 'invoke' },
    siteReader: { readSiteHtml: async () => undefined },
    dispatch: async (p) => {
      dispatched.push(p);
    },
    verify: async () => ({ github: 'ok' }),
    ...overrides,
  };
  return { deps, store, dispatched };
}

async function createSession(router: Router): Promise<string> {
  const res = await router.handle(ev('POST', '/sessions'));
  return JSON.parse(res.body).sessionId as string;
}

describe('router 매칭', () => {
  it('파라미터를 추출하고 method+segment 수로 매칭', () => {
    const r = new Router();
    r.get('/sessions/:id/records', () => ({ statusCode: 200, body: 'ok' }));
    const m = r.match('GET', '/sessions/abc/records');
    expect(m?.params.id).toBe('abc');
    expect(r.match('GET', '/sessions/abc')).toBeUndefined();
    expect(r.match('POST', '/sessions/abc/records')).toBeUndefined();
  });

  it('없는 경로는 404 JSON', async () => {
    const { deps } = makeDeps();
    const router = buildRouter(deps);
    const res = await router.handle(ev('GET', '/nope'));
    expect(res.statusCode).toBe(404);
    expect(res.headers?.['content-type']).toContain('application/json');
  });
});

describe('세션과 작업', () => {
  it('POST /sessions는 201과 sessionId', async () => {
    const { deps } = makeDeps();
    const router = buildRouter(deps);
    const res = await router.handle(ev('POST', '/sessions'));
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).sessionId).toBeTruthy();
  });

  it('collect Job은 선행조건 없이 202 + dispatch', async () => {
    const { deps, dispatched } = makeDeps();
    const router = buildRouter(deps);
    const sid = await createSession(router);
    const res = await router.handle(
      ev('POST', `/sessions/${sid}/jobs`, { kind: 'collect', connections: { githubToken: 't' } }),
    );
    expect(res.statusCode).toBe(202);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].kind).toBe('collect');
    expect(dispatched[0].connections?.githubToken).toBe('t');
  });

  it('keywords Job은 제외안된 기록 없으면 409', async () => {
    const { deps } = makeDeps();
    const router = buildRouter(deps);
    const sid = await createSession(router);
    const res = await router.handle(ev('POST', `/sessions/${sid}/jobs`, { kind: 'keywords' }));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('precondition');
  });

  it('keywords Job은 기록 있으면 202', async () => {
    const { deps, store } = makeDeps();
    const router = buildRouter(deps);
    const sid = await createSession(router);
    const rec: RecordItem = {
      id: 'r1',
      sessionId: sid,
      source: 'github',
      title: 't',
      body: 'b',
      url: 'u',
      excluded: false,
      meta: {},
    };
    await store.put({ PK: pk(sid), SK: SK.rec('r1'), ...rec });
    const res = await router.handle(ev('POST', `/sessions/${sid}/jobs`, { kind: 'keywords' }));
    expect(res.statusCode).toBe(202);
  });

  it('running Job이 있으면 409', async () => {
    const { deps, store } = makeDeps();
    const router = buildRouter(deps);
    const sid = await createSession(router);
    // collect Job 생성 → running 상태
    await router.handle(ev('POST', `/sessions/${sid}/jobs`, { kind: 'collect' }));
    const res = await router.handle(ev('POST', `/sessions/${sid}/jobs`, { kind: 'collect' }));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('job_running');
    // store에 JOB 2개가 아니라 확인용
    const jobs = await store.queryByPrefix(pk(sid), 'JOB#');
    expect(jobs.length).toBe(1);
  });

  it('GET /jobs/{jobId}는 마지막 점 앞으로 sessionId 역산', async () => {
    const { deps } = makeDeps();
    const router = buildRouter(deps);
    const sid = await createSession(router);
    const jr = await router.handle(ev('POST', `/sessions/${sid}/jobs`, { kind: 'collect' }));
    const jobId = JSON.parse(jr.body).jobId as string;
    const res = await router.handle(ev('GET', `/jobs/${jobId}`));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).id).toBe(jobId);
  });
});

describe('records 정렬 및 PATCH', () => {
  it('timeStart 내림차순, 없으면 맨 뒤', () => {
    const mk = (id: string, t?: string): RecordItem => ({
      id,
      sessionId: 's',
      source: 'github',
      title: id,
      timeStart: t,
      body: '',
      url: '',
      excluded: false,
      meta: {},
    });
    const arr = [mk('a', '2020'), mk('b'), mk('c', '2022')];
    arr.sort(compareByTimeStartDesc);
    expect(arr.map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('PATCH excluded=false 는 excludedReason 제거', async () => {
    const { deps, store } = makeDeps();
    const router = buildRouter(deps);
    const sid = await createSession(router);
    const rec: RecordItem = {
      id: 'r1',
      sessionId: sid,
      source: 'github',
      title: 't',
      body: 'b',
      url: 'u',
      excluded: true,
      excludedReason: 'fork 저장소',
      meta: {},
    };
    await store.put({ PK: pk(sid), SK: SK.rec('r1'), ...rec });
    const res = await router.handle(
      ev('PATCH', `/sessions/${sid}/records/r1`, { excluded: false }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.excluded).toBe(false);
    expect(body.excludedReason).toBeUndefined();
  });
});

describe('answer 저장 (AI 없음)', () => {
  it('yes + detail 저장, skip 매핑', async () => {
    const { deps, store } = makeDeps();
    const router = buildRouter(deps);
    const sid = await createSession(router);
    await store.put({
      PK: pk(sid),
      SK: SK.q('q1'),
      id: 'q1',
      keywordId: 'k1',
      text: '질문',
      inferredExperience: 'DB 구현',
      status: 'pending',
    });
    const res = await router.handle(
      ev('POST', `/sessions/${sid}/questions/q1/answer`, { answer: 'yes', detail: '  MySQL로  ' }),
    );
    expect(res.statusCode).toBe(200);
    const q = JSON.parse(res.body);
    expect(q.status).toBe('yes');
    expect(q.detail).toBe('MySQL로');

    const res2 = await router.handle(
      ev('POST', `/sessions/${sid}/questions/q1/answer`, { answer: 'skip' }),
    );
    expect(JSON.parse(res2.body).status).toBe('skipped');
    expect(JSON.parse(res2.body).detail).toBeUndefined();
  });

  it('잘못된 answer는 400', async () => {
    const { deps, store } = makeDeps();
    const router = buildRouter(deps);
    const sid = await createSession(router);
    await store.put({
      PK: pk(sid),
      SK: SK.q('q1'),
      id: 'q1',
      keywordId: 'k1',
      text: 'q',
      inferredExperience: 'x',
      status: 'pending',
    });
    const res = await router.handle(
      ev('POST', `/sessions/${sid}/questions/q1/answer`, { answer: 'maybe' }),
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('/sites 응답', () => {
  it('HTML Content-Type, 없으면 404 HTML', async () => {
    const { deps } = makeDeps({
      siteReader: {
        readSiteHtml: async (id) => (id === 'has' ? '<html>ok</html>' : undefined),
      },
    });
    const router = buildRouter(deps);
    const ok = await router.handle(ev('GET', '/sites/has'));
    expect(ok.statusCode).toBe(200);
    expect(ok.headers?.['content-type']).toBe('text/html; charset=utf-8');
    expect(ok.body).toContain('<html>');

    const miss = await router.handle(ev('GET', '/sites/none'));
    expect(miss.statusCode).toBe(404);
    expect(miss.headers?.['content-type']).toBe('text/html; charset=utf-8');
  });
});

describe('connections verify', () => {
  it('토큰별로 ok/fail 반환', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('api.github.com')) return { status: 200, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) };
      if (url.includes('api.notion.com')) return { status: 401, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) };
      return { status: 200, headers: new Headers(), arrayBuffer: async () => new TextEncoder().encode('<rss></rss>').buffer };
    });
    const out = await verifyConnections(
      { githubToken: 'g', notionToken: 'n', tistoryUrl: 'myblog.tistory.com' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(out).toEqual({ github: 'ok', notion: 'fail', tistory: 'ok' });
  });

  it('normalizeTistoryUrl은 스킴 보정 + 슬래시 제거', () => {
    expect(normalizeTistoryUrl('foo.tistory.com/')).toBe('https://foo.tistory.com');
    expect(normalizeTistoryUrl('https://foo.tistory.com')).toBe('https://foo.tistory.com');
  });
});
