// backend/src/pipeline/pipeline.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEvidence } from './extract.js';
import { consolidateActivities } from './consolidate.js';
import { composeMaster } from './master.js';
import { makeDeps, stubBedrock } from '../testkit.js';
import { validateEntry } from '../../../shared/validators.js';
import type { Artifact, Evidence } from '../../../shared/types.js';

function artifact(id: string, rawText: string): Artifact {
    return {
        id,
        sourceId: `src-${id}`,
        rawText,
        contentHash: 'h',
        fetchedAt: '2026-09-20T00:00:00.000Z',
        meta: {},
    };
}

// 문서 명세 픽스처 4종
const FX = {
    github: artifact('art-gh', '# 크롤러 프로젝트\nREST API를 설계하고 크롤링 문제를 해결했다. TypeScript로 구현했다.'),
    blog: artifact('art-blog', '스터디를 6개월간 운영했다. 매주 발표를 맡았고 회고를 남겼다.'),
    notion: artifact('art-notion', '오늘 API 짰음 ㅋㅋ 드디어 테스트 다 통과함. 팀원들이랑 밤샜다'),
    contest: artifact('art-contest', '2026년 봄 공모전에서 대상을 수상했다. 사용자 문제 정의가 핵심이었다.'),
};

// ---------- extractEvidence ----------
test('extractEvidence: verifyQuote 통과분만 남기고 없는 인용은 폐기', async () => {
    const bedrock = stubBedrock(() => ({
        evidences: [
            { field: 'what', claim: 'REST API를 설계했다', quote: 'REST API를 설계하고' }, // 원문에 있음
            { field: 'result', claim: '없는 성과', quote: '노벨상을 받았다' }, // 원문에 없음 → 폐기
            { field: 'tech', claim: 'TS 사용', quote: 'TypeScript로 구현했다' }, // 있음
        ],
    }));
    const deps = makeDeps({ bedrock });
    const out = await extractEvidence(FX.github, deps);
    assert.equal(out.keptCount, 2);
    assert.equal(out.droppedCount, 1);
    // start/end 가 원문 위치를 정확히 가리키는지
    for (const e of out.evidence) {
        assert.equal(FX.github.rawText.slice(e.quoteRef.start, e.quoteRef.end), e.quoteRef.quote);
    }
});

test('extractEvidence: 스키마 밖 field 는 폐기', async () => {
    const bedrock = stubBedrock(() => ({
        evidences: [{ field: 'nonsense', claim: 'x', quote: '스터디를 6개월간 운영했다' }],
    }));
    const deps = makeDeps({ bedrock });
    const out = await extractEvidence(FX.blog, deps);
    assert.equal(out.keptCount, 0);
    assert.equal(out.droppedCount, 1);
});

// ---------- consolidateActivities ----------
function evd(id: string, artifactId: string, claim: string): Evidence {
    return {
        id,
        field: 'what',
        claim,
        quoteRef: { artifactId, quote: claim, start: 0, end: claim.length },
    };
}

test('consolidateActivities: 그룹핑 + activityId 부여 + merged 크기', async () => {
    const evidence = [evd('e1', 'art-gh', 'a'), evd('e2', 'art-blog', 'b'), evd('e3', 'art-notion', 'c')];
    // e1,e2 를 한 활동으로 묶고 e3 는 빠뜨린다 → e3 는 단독 활동
    const bedrock = stubBedrock(() => ({ groups: [{ evidenceIds: ['e1', 'e2'] }] }));
    const deps = makeDeps({ bedrock });
    const out = await consolidateActivities(evidence, deps);
    assert.equal(out.activityCount, 2); // {e1,e2}, {e3}
    assert.deepEqual(out.mergedGroupSizes, [2]);
    // 모든 Evidence 가 정확히 하나의 activityId 를 가진다
    const e1 = out.evidence.find((e) => e.id === 'e1')!;
    const e2 = out.evidence.find((e) => e.id === 'e2')!;
    const e3 = out.evidence.find((e) => e.id === 'e3')!;
    assert.equal(e1.activityId, e2.activityId);
    assert.notEqual(e1.activityId, e3.activityId);
    assert.ok(e3.activityId);
});

test('consolidateActivities: 빈 입력', async () => {
    const out = await consolidateActivities([], makeDeps());
    assert.equal(out.activityCount, 0);
});

// ---------- composeMaster ----------
test('composeMaster: validateEntry 통과 폼 생성 + 정렬', async () => {
    const evidence: Evidence[] = [
        { ...evd('e1', 'art-gh', 'API 설계'), activityId: 'act-1' },
        { ...evd('e2', 'art-contest', '대상 수상'), activityId: 'act-2' },
    ];
    // fill_activity 호출 시 activity 별로 유효한 폼을 낸다(evidenceIds 는 그 활동 근거만)
    const bedrock = stubBedrock((call) => {
        const usesE1 = call.prompt.includes('e1');
        const eid = usesE1 ? 'e1' : 'e2';
        const start = usesE1 ? '2026-03' : '2026-01';
        return {
            title: { text: '제목', evidenceIds: [eid] },
            type: 'project',
            period: { start, inferred: false, evidenceIds: [eid] },
            affiliationRole: null,
            summary: { text: '요약', evidenceIds: [eid] },
            what: [{ text: '무엇', evidenceIds: [eid] }],
            how: [],
            result: [],
            tech: ['TypeScript'],
            outcome: null,
        };
    });
    const deps = makeDeps({ bedrock });
    const master = await composeMaster('pf-1', evidence, deps);
    assert.equal(master.kind, 'master');
    assert.equal(master.entries.length, 2);
    // 정렬: 2026-01 (act-2) 가 먼저
    assert.equal(master.entries[0].period?.start, '2026-01');
    assert.equal(master.entries[1].period?.start, '2026-03');
    // 각 entry 가 validateEntry 통과
    for (const entry of master.entries) {
        const allowed = new Set(evidence.filter((e) => e.activityId === entry.activityId).map((e) => e.id));
        assert.deepEqual(validateEntry(entry, allowed), []);
    }
});

test('composeMaster: 위반 응답 → 1회 재시도 → 그래도 위반이면 문장 삭제', async () => {
    const evidence: Evidence[] = [{ ...evd('e1', 'art-gh', 'API'), activityId: 'act-1' }];
    let callCount = 0;
    const bedrock = stubBedrock(() => {
        callCount++;
        // 항상 what 에 없는 근거 id(e-fake)를 넣어 위반을 유발
        return {
            title: { text: '제목', evidenceIds: ['e1'] },
            type: 'project',
            period: null,
            affiliationRole: null,
            summary: { text: '요약', evidenceIds: ['e1'] },
            what: [{ text: '거짓', evidenceIds: ['e-fake'] }],
            how: [],
            result: [],
            tech: [],
            outcome: null,
        };
    });
    const deps = makeDeps({ bedrock });
    const master = await composeMaster('pf-1', evidence, deps);
    // 최초 + 재시도 = 2회 호출
    assert.equal(callCount, 2);
    // 위반 문장(what)이 삭제됨
    assert.equal(master.entries[0].what.length, 0);
    // 나머지 유효 문장은 남음
    assert.equal(master.entries[0].title.text, '제목');
});

// ---------- end-to-end (T1) ----------
test('파이프라인 T1: 추출 → 통합 → 마스터 (가짜 데이터 end-to-end)', async () => {
    const bedrock = stubBedrock((call) => {
        if (call.toolName === 'record_evidence') {
            // 원문에 실제로 있는 인용만
            if (call.prompt.includes('크롤러')) {
                return { evidences: [{ field: 'what', claim: 'API 설계', quote: 'REST API를 설계하고' }] };
            }
            return { evidences: [{ field: 'result', claim: '수상', quote: '대상을 수상했다' }] };
        }
        if (call.toolName === 'group_activities') {
            return { groups: [] }; // 전부 단독 활동
        }
        // fill_activity
        const eid = call.prompt.includes('API 설계') ? undefined : undefined;
        // 프롬프트에서 근거 id 를 못 정하니, 첫 근거를 쓴다: 테스트는 evidenceIds 를 프롬프트의 첫 e-id 로
        const m = call.prompt.match(/- (evd_[0-9a-f]+)/);
        const useId = m ? m[1] : 'evd_1';
        return {
            title: { text: '활동', evidenceIds: [useId] },
            type: 'project',
            period: { start: '2026-02', inferred: true, evidenceIds: [useId] },
            affiliationRole: null,
            summary: { text: '요약', evidenceIds: [useId] },
            what: [{ text: '무엇', evidenceIds: [useId] }],
            how: [],
            result: [],
            tech: [],
            outcome: null,
        };
    });
    const deps = makeDeps({ bedrock });

    // 추출 (2개 아티팩트)
    const ex1 = await extractEvidence(FX.github, deps);
    const ex2 = await extractEvidence(FX.contest, deps);
    const allEvidence = [...ex1.evidence, ...ex2.evidence];
    assert.equal(allEvidence.length, 2);

    // 통합
    const cons = await consolidateActivities(allEvidence, deps);
    assert.equal(cons.activityCount, 2);

    // 마스터
    const master = await composeMaster('pf-1', cons.evidence, deps);
    assert.equal(master.entries.length, 2);
    // 모든 entry 가 검증 통과
    for (const entry of master.entries) {
        const allowed = new Set(cons.evidence.filter((e) => e.activityId === entry.activityId).map((e) => e.id));
        assert.deepEqual(validateEntry(entry, allowed), [], `entry ${entry.activityId} 위반`);
    }
    // 기간 추정 꼬리표
    assert.ok(master.entries.every((e) => e.period?.inferred === true));
});
