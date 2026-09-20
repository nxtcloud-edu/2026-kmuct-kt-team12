// backend/src/worker/worker.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCollect, runPipeline, runTailor, type CollectorDeps } from './worker.js';
import { makeDeps, stubBedrock } from '../testkit.js';
import { mockHttp } from '../collect/testkit.js';
import type { Job, JobInvoker, Deps } from '../ports.js';
import type { Source, Run } from '../../../shared/types.js';

function collectHttp() {
    const readme = Buffer.from('REST API를 설계했다', 'utf8').toString('base64');
    return mockHttp([
        { match: '/repos/o/r/readme', body: JSON.stringify({ content: readme }) },
        { match: '/repos/o/r/languages', body: JSON.stringify({ TypeScript: 1 }) },
        { match: '/repos/o/r/commits', body: JSON.stringify([{ commit: { author: { date: '2026-01-01T00:00:00Z' } } }]) },
        { match: '/repos/o/r', body: JSON.stringify({ full_name: 'o/r' }) },
        { match: 'blog', body: '<body><p>스터디를 운영했다</p></body>' },
    ]);
}

function pipelineBedrock() {
    return stubBedrock((call) => {
        if (call.toolName === 'record_evidence') {
            if (call.prompt.includes('REST API')) {
                return { evidences: [{ field: 'what', claim: 'API 설계', quote: 'REST API를 설계했다' }] };
            }
            return { evidences: [{ field: 'what', claim: '스터디 운영', quote: '스터디를 운영했다' }] };
        }
        if (call.toolName === 'group_activities') return { groups: [] };
        const m = call.prompt.match(/- (evd_[0-9a-f]+)/);
        const useId = m ? m[1] : 'evd_x';
        return {
            title: { text: '활동', evidenceIds: [useId] }, type: 'project',
            period: { start: '2026-01', inferred: false, evidenceIds: [useId] },
            affiliationRole: null, summary: { text: '요약', evidenceIds: [useId] },
            what: [{ text: '무엇', evidenceIds: [useId] }], how: [], result: [], tech: [], outcome: null,
        };
    });
}

function newRun(id: string, portfolioId: string, mode: Run['mode']): Run {
    return { id, portfolioId, mode, status: 'running', events: [] };
}

async function seedSources(deps: Deps) {
    await deps.store.createPortfolio('pf-1');
    await deps.store.putSource({ id: 'src-gh', portfolioId: 'pf-1', kind: 'github', url: 'https://github.com/o/r', addedAt: '2026-09-20T00:00:00.000Z' } as Source);
    await deps.store.putSource({ id: 'src-blog', portfolioId: 'pf-1', kind: 'web', url: 'https://blog.example.com/x', addedAt: '2026-09-20T00:00:00.000Z' } as Source);
}

/** collect→pipeline 을 즉시 이어 실행하는 인메모리 JobInvoker (체이닝 검증용). */
function chainingInvoker(deps: Deps): { jobs: JobInvoker; log: Job[] } {
    const log: Job[] = [];
    const jobs: JobInvoker = {
        async invoke(job: Job) {
            log.push(job);
            if (job.kind === 'collect') {
                await runCollect({ portfolioId: job.portfolioId, runId: job.runId, mode: job.mode }, { ...deps, jobs });
            } else if (job.kind === 'pipeline') {
                await runPipeline({ portfolioId: job.portfolioId, runId: job.runId, mode: job.mode }, deps);
            } else {
                await runTailor(
                    { portfolioId: job.portfolioId, runId: job.runId, targetRole: job.targetRole, jdText: job.jdText, selectedActivityIds: job.selectedActivityIds },
                    deps,
                );
            }
        },
    };
    return { jobs, log };
}

// ---------- collect → pipeline 체이닝 end-to-end ----------
test('runCollect → (invoke) → runPipeline 체이닝: 수집 후 마스터까지', async () => {
    const deps = makeDeps({ http: collectHttp(), bedrock: pipelineBedrock() });
    await seedSources(deps);
    await deps.store.putRun(newRun('run-1', 'pf-1', 'build'));

    const { jobs, log } = chainingInvoker(deps);
    // API 가 하듯 collect 부터 시작
    await jobs.invoke({ kind: 'collect', mode: 'build', portfolioId: 'pf-1', runId: 'run-1' });

    // collect 1회 + pipeline 1회가 호출됐다
    assert.deepEqual(log.map((j) => j.kind), ['collect', 'pipeline']);

    // 마스터가 저장되고 run 이 done
    const master = await deps.store.getMaster('pf-1');
    assert.ok(master);
    assert.equal(master!.entries.length, 2);
    const run = await deps.store.getRun('run-1');
    assert.equal(run!.status, 'done');
    const msgs = run!.events.map((e) => e.message).join(' | ');
    assert.ok(msgs.includes('수집'), msgs);
    assert.ok(msgs.includes('마스터 타임라인'), msgs);
});

// ---------- runCollect 는 status 를 done 으로 만들지 않는다 ----------
test('runCollect 는 수집만 하고 pipeline 을 invoke 한다 (status 는 pipeline 이 done)', async () => {
    const deps = makeDeps({ http: collectHttp(), bedrock: pipelineBedrock() });
    await seedSources(deps);
    await deps.store.putRun(newRun('run-c', 'pf-1', 'build'));

    // pipeline 을 실행하지 않는 no-op invoker
    const invoked: Job[] = [];
    const jobs: JobInvoker = { async invoke(job) { invoked.push(job); } };
    const cdeps: CollectorDeps = { ...deps, jobs };

    await runCollect({ portfolioId: 'pf-1', runId: 'run-c', mode: 'build' }, cdeps);

    // pipeline job 을 invoke 했다
    assert.equal(invoked.length, 1);
    assert.equal(invoked[0].kind, 'pipeline');
    // 아직 마스터 없음(파이프라인 미실행), run 은 running 유지
    assert.equal(await deps.store.getMaster('pf-1'), null);
    assert.equal((await deps.store.getRun('run-c'))!.status, 'running');
});

// ---------- refresh: lockedFields 보존 ----------
test('runPipeline refresh: lockedFields 보존', async () => {
    const deps = makeDeps({ http: collectHttp(), bedrock: pipelineBedrock() });
    await seedSources(deps);
    await deps.store.putRun(newRun('run-1', 'pf-1', 'build'));
    const { jobs } = chainingInvoker(deps);
    await jobs.invoke({ kind: 'collect', mode: 'build', portfolioId: 'pf-1', runId: 'run-1' });

    // 사용자가 첫 활동 summary 를 고치고 잠금
    const master = await deps.store.getMaster('pf-1');
    const edited = structuredClone(master!);
    edited.entries[0].summary = { text: '사용자가 고친 요약', evidenceIds: edited.entries[0].summary.evidenceIds };
    edited.entries[0].lockedFields = ['summary'];
    await deps.store.putMaster(edited);

    // refresh 파이프라인 직접 실행(수집은 이미 됨)
    await deps.store.putRun(newRun('run-2', 'pf-1', 'refresh'));
    const refreshed = await runPipeline({ portfolioId: 'pf-1', runId: 'run-2', mode: 'refresh' }, deps);
    const target = refreshed.entries.find((e) => e.lockedFields.includes('summary'));
    assert.ok(target);
    assert.equal(target!.summary.text, '사용자가 고친 요약');
    assert.equal((await deps.store.getRun('run-2'))!.status, 'done');
});

// ---------- tailor ----------
test('runTailor: 마스터 없으면 failed', async () => {
    const deps = makeDeps();
    await deps.store.createPortfolio('pf-1');
    await deps.store.putRun(newRun('run-x', 'pf-1', 'tailor'));
    await assert.rejects(
        runTailor({ portfolioId: 'pf-1', runId: 'run-x', targetRole: 'x', selectedActivityIds: [] }, deps),
        /마스터가 아직 없습니다/,
    );
    assert.equal((await deps.store.getRun('run-x'))!.status, 'failed');
});
