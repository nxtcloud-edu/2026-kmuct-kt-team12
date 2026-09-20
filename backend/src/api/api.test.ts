// backend/src/api/api.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, type ApiDeps } from './api.js';
import { runCollect, runPipeline, runTailor } from '../worker/worker.js';
import { makeDeps, stubBedrock } from '../testkit.js';
import { mockHttp } from '../collect/testkit.js';
import type { Job, JobInvoker } from '../ports.js';

// build/tailor 파이프라인을 모두 도는 Bedrock 스텁
function fullBedrock() {
    return stubBedrock((call) => {
        if (call.toolName === 'record_evidence') {
            return { evidences: [{ field: 'what', claim: 'API 설계', quote: 'REST API를 설계했다' }] };
        }
        if (call.toolName === 'group_activities') return { groups: [] };
        if (call.toolName === 'fill_activity') {
            const m = call.prompt.match(/- (evd_[0-9a-f]+)/);
            const useId = m ? m[1] : 'evd_x';
            return {
                title: { text: '활동', evidenceIds: [useId] }, type: 'project',
                period: { start: '2026-01', inferred: false, evidenceIds: [useId] },
                affiliationRole: null, summary: { text: '요약', evidenceIds: [useId] },
                what: [{ text: '무엇', evidenceIds: [useId] }], how: [], result: [], tech: [], outcome: null,
            };
        }
        if (call.toolName === 'extract_competencies') {
            return { competencies: [{ name: 'API' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }] };
        }
        // retell
        const ev = call.prompt.match(/허용 근거 id: (evd_[0-9a-f]+)/);
        const useId = ev ? ev[1] : 'evd_x';
        return {
            intro: [
                { text: '소개1', evidenceIds: [useId] },
                { text: '소개2', evidenceIds: [useId] },
                { text: '소개3', evidenceIds: [useId] },
            ],
            entries: [],
            competencyEvidence: [{ name: 'API', evidenceIds: [useId] }],
        };
    });
}

function githubHttp() {
    const readme = Buffer.from('REST API를 설계했다', 'utf8').toString('base64');
    return mockHttp([
        { match: '/repos/o/r/readme', body: JSON.stringify({ content: readme }) },
        { match: '/repos/o/r/languages', body: JSON.stringify({ TypeScript: 1 }) },
        { match: '/repos/o/r/commits', body: JSON.stringify([{ commit: { author: { date: '2026-01-01T00:00:00Z' } } }]) },
        { match: '/repos/o/r', body: JSON.stringify({ full_name: 'o/r' }) },
    ]);
}

/** API + 즉시 실행 Worker 를 조립한다(비동기 대신 그 자리에서 실행해 end-to-end 확인). */
function makeApiDeps() {
    const base = makeDeps({ http: githubHttp(), bedrock: fullBedrock() });
    const jobLog: Job[] = [];
    const jobs: JobInvoker = {
        async invoke(job: Job) {
            jobLog.push(job);
            if (job.kind === 'collect') {
                // 수집 후 파이프라인으로 이어짐(runCollect 가 이 invoker 로 pipeline 을 부른다)
                await runCollect({ portfolioId: job.portfolioId, runId: job.runId, mode: job.mode }, { ...base, jobs });
            } else if (job.kind === 'pipeline') {
                await runPipeline({ portfolioId: job.portfolioId, runId: job.runId, mode: job.mode }, base);
            } else {
                await runTailor(
                    {
                        portfolioId: job.portfolioId,
                        runId: job.runId,
                        targetRole: job.targetRole,
                        jdText: job.jdText,
                        selectedActivityIds: job.selectedActivityIds,
                    },
                    base,
                );
            }
        },
    };
    const deps: ApiDeps = { ...base, jobs };
    return { deps, jobLog };
}

test('API 전체 흐름: 포트폴리오 생성 → 출처 등록 → build → 마스터 조회', async () => {
    const { deps } = makeApiDeps();

    // POST /portfolios
    const create = await handle({ method: 'POST', path: '/portfolios' }, deps);
    assert.equal(create.status, 201);
    const portfolioId = (create.body as { portfolioId: string }).portfolioId;

    // POST /portfolios/{id}/sources (github)
    const addSrc = await handle(
        { method: 'POST', path: `/portfolios/${portfolioId}/sources`, body: { kind: 'github', url: 'https://github.com/o/r' } },
        deps,
    );
    assert.equal(addSrc.status, 201);

    // POST /portfolios/{id}/runs (build) → 202 runId, 즉시 실행됨
    const run = await handle({ method: 'POST', path: `/portfolios/${portfolioId}/runs`, body: { mode: 'build' } }, deps);
    assert.equal(run.status, 202);
    const runId = (run.body as { runId: string }).runId;

    // GET /runs/{runId} → done
    const runStatus = await handle({ method: 'GET', path: `/runs/${runId}` }, deps);
    assert.equal(runStatus.status, 200);
    assert.equal((runStatus.body as { status: string }).status, 'done');

    // GET /portfolios/{id} → 마스터 존재
    const get = await handle({ method: 'GET', path: `/portfolios/${portfolioId}` }, deps);
    assert.equal(get.status, 200);
    const gb = get.body as { master: { entries: unknown[] } | null; sources: unknown[] };
    assert.ok(gb.master, '마스터가 있어야 함');
    assert.equal(gb.master!.entries.length, 1);
    assert.equal(gb.sources.length, 1);
});

test('API: 파일 출처는 presigned uploadUrl 반환', async () => {
    const { deps } = makeApiDeps();
    const create = await handle({ method: 'POST', path: '/portfolios' }, deps);
    const portfolioId = (create.body as { portfolioId: string }).portfolioId;
    const res = await handle(
        { method: 'POST', path: `/portfolios/${portfolioId}/sources`, body: { kind: 'file', fileName: '기획서.pdf', contentType: 'application/pdf' } },
        deps,
    );
    assert.equal(res.status, 201);
    const b = res.body as { uploadUrl?: string; source: { s3Key?: string } };
    assert.ok(b.uploadUrl, 'uploadUrl 발급');
    assert.ok(b.source.s3Key, 's3Key 보관');
});

test('API: DELETE 출처 → 204', async () => {
    const { deps } = makeApiDeps();
    const create = await handle({ method: 'POST', path: '/portfolios' }, deps);
    const portfolioId = (create.body as { portfolioId: string }).portfolioId;
    const add = await handle(
        { method: 'POST', path: `/portfolios/${portfolioId}/sources`, body: { kind: 'github', url: 'https://github.com/o/r' } },
        deps,
    );
    const sourceId = (add.body as { source: { id: string } }).source.id;
    const del = await handle({ method: 'DELETE', path: `/portfolios/${portfolioId}/sources/${sourceId}` }, deps);
    assert.equal(del.status, 204);
    const get = await handle({ method: 'GET', path: `/portfolios/${portfolioId}` }, deps);
    assert.equal((get.body as { sources: unknown[] }).sources.length, 0);
});

test('API: PATCH entry → 칸 잠금(lockedFields)', async () => {
    const { deps } = makeApiDeps();
    const create = await handle({ method: 'POST', path: '/portfolios' }, deps);
    const portfolioId = (create.body as { portfolioId: string }).portfolioId;
    await handle({ method: 'POST', path: `/portfolios/${portfolioId}/sources`, body: { kind: 'github', url: 'https://github.com/o/r' } }, deps);
    await handle({ method: 'POST', path: `/portfolios/${portfolioId}/runs`, body: { mode: 'build' } }, deps);
    const get = await handle({ method: 'GET', path: `/portfolios/${portfolioId}` }, deps);
    const activityId = (get.body as { master: { entries: { activityId: string }[] } }).master.entries[0].activityId;

    const patch = await handle(
        {
            method: 'PATCH',
            path: `/portfolios/${portfolioId}/entries/${activityId}`,
            body: { summary: { text: '직접 고친 요약', evidenceIds: [] }, lockedFields: ['summary'] },
        },
        deps,
    );
    assert.equal(patch.status, 200);
    const entry = patch.body as { lockedFields: string[]; summary: { text: string } };
    assert.ok(entry.lockedFields.includes('summary'));
    assert.equal(entry.summary.text, '직접 고친 요약');
});

test('API: 맞춤본 생성(POST outputs) → 목록/단건 조회', async () => {
    const { deps } = makeApiDeps();
    const create = await handle({ method: 'POST', path: '/portfolios' }, deps);
    const portfolioId = (create.body as { portfolioId: string }).portfolioId;
    await handle({ method: 'POST', path: `/portfolios/${portfolioId}/sources`, body: { kind: 'github', url: 'https://github.com/o/r' } }, deps);
    await handle({ method: 'POST', path: `/portfolios/${portfolioId}/runs`, body: { mode: 'build' } }, deps);
    const get = await handle({ method: 'GET', path: `/portfolios/${portfolioId}` }, deps);
    const activityId = (get.body as { master: { entries: { activityId: string }[] } }).master.entries[0].activityId;

    // POST outputs
    const out = await handle(
        { method: 'POST', path: `/portfolios/${portfolioId}/outputs`, body: { targetRole: '백엔드 개발자', activityIds: [activityId] } },
        deps,
    );
    assert.equal(out.status, 202);

    // GET outputs (목록)
    const list = await handle({ method: 'GET', path: `/portfolios/${portfolioId}/outputs` }, deps);
    assert.equal(list.status, 200);
    const arr = list.body as Array<{ id: string; targetRole: string; stale: boolean }>;
    assert.equal(arr.length, 1);
    assert.equal(arr[0].targetRole, '백엔드 개발자');
    assert.equal(arr[0].stale, false);

    // GET /outputs/{outputId} (단건)
    const one = await handle({ method: 'GET', path: `/outputs/${arr[0].id}` }, deps);
    assert.equal(one.status, 200);
    assert.equal((one.body as { targetRole: string }).targetRole, '백엔드 개발자');
});

test('API: 없는 라우트 404, 없는 run 404', async () => {
    const { deps } = makeApiDeps();
    assert.equal((await handle({ method: 'GET', path: '/nope' }, deps)).status, 404);
    assert.equal((await handle({ method: 'GET', path: '/runs/none' }, deps)).status, 404);
});
