// backend/src/worker/handlers.test.ts
// Lambda 핸들러 3개가 Job 을 올바른 도메인 함수로 라우팅하는지 검증한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleCollect } from '../collector/handler.js';
import { handlePipeline } from '../pipeline/handler.js';
import { makeDeps, stubBedrock } from '../testkit.js';
import { mockHttp } from '../collect/testkit.js';
import type { Source, Run } from '../../../shared/types.js';
import type { Job, JobInvoker, Deps } from '../ports.js';

function http() {
    const readme = Buffer.from('REST API를 설계했다', 'utf8').toString('base64');
    return mockHttp([
        { match: '/repos/o/r/readme', body: JSON.stringify({ content: readme }) },
        { match: '/repos/o/r/languages', body: JSON.stringify({ TypeScript: 1 }) },
        { match: '/repos/o/r/commits', body: JSON.stringify([{ commit: { author: { date: '2026-01-01T00:00:00Z' } } }]) },
        { match: '/repos/o/r', body: JSON.stringify({ full_name: 'o/r' }) },
    ]);
}
function bedrock() {
    return stubBedrock((call) => {
        if (call.toolName === 'record_evidence') return { evidences: [{ field: 'what', claim: 'API', quote: 'REST API를 설계했다' }] };
        if (call.toolName === 'group_activities') return { groups: [] };
        const m = call.prompt.match(/- (evd_[0-9a-f]+)/);
        const id = m ? m[1] : 'evd_x';
        return {
            title: { text: '활동', evidenceIds: [id] }, type: 'project',
            period: null, affiliationRole: null, summary: { text: '요약', evidenceIds: [id] },
            what: [{ text: '무엇', evidenceIds: [id] }], how: [], result: [], tech: [], outcome: null,
        };
    });
}
function run(id: string): Run {
    return { id, portfolioId: 'pf-1', mode: 'build', status: 'running', events: [] };
}

test('handleCollect → handlePipeline: 핸들러 체이닝으로 마스터까지', async () => {
    const base: Deps = makeDeps({ http: http(), bedrock: bedrock() });
    await base.store.createPortfolio('pf-1');
    await base.store.putSource({ id: 'src-gh', portfolioId: 'pf-1', kind: 'github', url: 'https://github.com/o/r', addedAt: '2026-09-20T00:00:00.000Z' } as Source);
    await base.store.putRun(run('run-1'));

    // collect 핸들러가 부르는 pipeline job 을 pipeline 핸들러로 이어준다
    const log: Job[] = [];
    const jobs: JobInvoker = {
        async invoke(job: Job) {
            log.push(job);
            if (job.kind === 'pipeline') await handlePipeline(job, base);
        },
    };

    await handleCollect({ kind: 'collect', mode: 'build', portfolioId: 'pf-1', runId: 'run-1' }, { ...base, jobs });

    assert.deepEqual(log.map((j) => j.kind), ['pipeline']);
    const master = await base.store.getMaster('pf-1');
    assert.ok(master);
    assert.equal((await base.store.getRun('run-1'))!.status, 'done');
});
