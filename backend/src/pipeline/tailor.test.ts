// backend/src/pipeline/tailor.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    interpretRole,
    rankActivities,
    composeTailored,
    isMasterNewer,
} from './tailor.js';
import { makeDeps, stubBedrock } from '../testkit.js';
import { validateTailored } from '../../../shared/validators.js';
import type { MasterOutput, ActivityEntry, Sentence } from '../../../shared/types.js';

function sentence(text: string, ids: string[]): Sentence {
    return { text, evidenceIds: ids };
}
function entry(activityId: string, ev: string): ActivityEntry {
    return {
        activityId,
        title: sentence('제목', [ev]),
        type: 'project',
        period: { start: '2026-01', inferred: false, evidenceIds: [ev] },
        affiliationRole: null,
        summary: sentence('요약', [ev]),
        what: [sentence('무엇', [ev])],
        how: [],
        result: [],
        tech: ['TypeScript'],
        outcome: null,
        sourceIds: ['src-1'],
        lockedFields: [],
    };
}

const MASTER: MasterOutput = {
    kind: 'master',
    portfolioId: 'pf-1',
    entries: [entry('act-1', 'e1'), entry('act-2', 'e2')],
    generatedAt: '2026-09-20T00:00:00.000Z',
};

// 활동별 허용 근거
const ALLOWED = new Map([
    ['act-1', ['e1']],
    ['act-2', ['e2']],
]);

// ---------- interpretRole ----------
test('interpretRole: 역량 목록 생성 (evidenceIds 는 비어 시작)', async () => {
    const bedrock = stubBedrock(() => ({
        competencies: [{ name: 'REST API 설계' }, { name: '문제 해결' }, { name: '협업' }, { name: '테스트' }, { name: 'TypeScript' }],
    }));
    const deps = makeDeps({ bedrock });
    const comps = await interpretRole('백엔드 개발자', undefined, deps);
    assert.equal(comps.length, 5);
    assert.ok(comps.every((c) => c.evidenceIds.length === 0));
});

// ---------- rankActivities ----------
test('rankActivities: 점수 내림차순, 누락 활동은 0점', async () => {
    const bedrock = stubBedrock(() => ({ ranked: [{ activityId: 'act-2', score: 0.9 }] }));
    const deps = makeDeps({ bedrock });
    const ranked = await rankActivities(MASTER, [{ name: 'x', evidenceIds: [] }], deps);
    assert.equal(ranked[0].activityId, 'act-2');
    assert.equal(ranked[0].score, 0.9);
    assert.equal(ranked[1].activityId, 'act-1');
    assert.equal(ranked[1].score, 0);
});

// ---------- composeTailored (T1) ----------
test('03-tailor T1: 샘플 마스터 + "백엔드 개발자" → TailoredOutput (end-to-end)', async () => {
    const bedrock = stubBedrock((call) => {
        if (call.toolName === 'extract_competencies') {
            return { competencies: [{ name: 'REST API 설계' }, { name: '문제 해결' }, { name: '협업' }, { name: '테스트' }, { name: 'TS' }] };
        }
        // retell: act-1 만 선택했다고 가정 → e1 만 허용
        return {
            intro: [
                sentence('백엔드 지원자입니다', ['e1']),
                sentence('API 설계 경험이 있습니다', ['e1']),
                sentence('문제 해결에 강합니다', ['e1']),
            ],
            entries: [entry('act-1', 'e1')],
            competencyEvidence: [
                { name: 'REST API 설계', evidenceIds: ['e1'] },
                { name: '문제 해결', evidenceIds: ['e1'] },
                { name: '협업', evidenceIds: [] }, // 근거 없음 → 공백 리포트
            ],
        };
    });
    const deps = makeDeps({ bedrock });
    const out = await composeTailored('pf-1', MASTER, '백엔드 개발자', undefined, ['act-1'], ALLOWED, deps);

    assert.equal(out.kind, 'tailored');
    assert.equal(out.targetRole, '백엔드 개발자');
    assert.equal(out.basedOnMasterAt, MASTER.generatedAt);
    // validateTailored 통과 (허용 e1 안에서만)
    assert.deepEqual(validateTailored(out, new Set(['e1'])), []);
    // 공백 리포트: 협업은 근거 없음
    const gap = out.competencies.find((c) => c.name === '협업');
    assert.ok(gap && gap.evidenceIds.length === 0, '근거 없는 역량은 빈 evidenceIds');
});

test('composeTailored: 근거 밖 evidenceId 응답 → 재시도 → 그래도 위반이면 문장 삭제', async () => {
    let calls = 0;
    const bedrock = stubBedrock((call) => {
        if (call.toolName === 'extract_competencies') {
            return { competencies: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }] };
        }
        calls++;
        // 항상 intro 에 허용 밖 e-fake 를 섞는다
        return {
            intro: [
                sentence('정상', ['e1']),
                sentence('과장', ['e-fake']),
                sentence('정상2', ['e1']),
            ],
            entries: [],
            competencyEvidence: [],
        };
    });
    const deps = makeDeps({ bedrock });
    const out = await composeTailored('pf-1', MASTER, '백엔드', undefined, ['act-1'], ALLOWED, deps);
    // retell 2회(최초+재시도)
    assert.equal(calls, 2);
    // 허용 밖 문장 삭제됨 → intro 2개만 남음
    assert.equal(out.intro.length, 2);
    assert.ok(out.intro.every((s) => s.evidenceIds.every((id) => id === 'e1')));
});

// ---------- isMasterNewer ----------
test('isMasterNewer: 마스터가 더 새로우면 true (원본이 바뀜)', () => {
    const older = { ...MASTER, generatedAt: '2026-09-19T00:00:00.000Z' };
    const tailored = {
        kind: 'tailored' as const,
        id: 't1',
        portfolioId: 'pf-1',
        targetRole: 'x',
        competencies: [],
        intro: [],
        entries: [],
        basedOnMasterAt: '2026-09-20T00:00:00.000Z',
        generatedAt: '2026-09-20T00:00:00.000Z',
    };
    assert.equal(isMasterNewer(older, tailored), false);
    assert.equal(isMasterNewer({ ...MASTER, generatedAt: '2026-09-21T00:00:00.000Z' }, tailored), true);
});
