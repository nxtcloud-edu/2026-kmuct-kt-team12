// backend/src/pipeline/refresh.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedSourceIds, preserveLockedFields, applyLockedFields } from './refresh.js';
import type { Artifact, ActivityEntry, MasterOutput, Sentence } from '../../../shared/types.js';

function art(sourceId: string, hash: string): Artifact {
    return {
        id: `art-${sourceId}`,
        sourceId,
        rawText: '',
        contentHash: hash,
        fetchedAt: '2026-09-20T00:00:00.000Z',
        meta: {},
    };
}

test('changedSourceIds: 해시가 바뀐 출처만', () => {
    const prev = [art('s1', 'h1'), art('s2', 'h2')];
    const cur = [art('s1', 'h1'), art('s2', 'h2-new'), art('s3', 'h3')];
    const changed = changedSourceIds(prev, cur);
    assert.ok(!changed.has('s1'), 's1 은 안 바뀜');
    assert.ok(changed.has('s2'), 's2 는 바뀜');
    assert.ok(changed.has('s3'), 's3 은 신규');
});

function sentence(text: string): Sentence {
    return { text, evidenceIds: ['e1'] };
}
function entry(over: Partial<ActivityEntry> = {}): ActivityEntry {
    return {
        activityId: 'act-1',
        title: sentence('제목'),
        type: 'project',
        period: null,
        affiliationRole: null,
        summary: sentence('요약'),
        what: [sentence('무엇')],
        how: [],
        result: [],
        tech: [],
        outcome: null,
        sourceIds: ['src-1'],
        lockedFields: [],
        ...over,
    };
}

test('preserveLockedFields: 잠긴 칸은 이전 값 유지, 나머지는 새 값', () => {
    const prev = entry({
        summary: { text: '사용자가 직접 고친 요약', evidenceIds: ['e1'] },
        lockedFields: ['summary'],
    });
    const prevMaster: MasterOutput = {
        kind: 'master',
        portfolioId: 'pf-1',
        entries: [prev],
        generatedAt: '2026-09-20T00:00:00.000Z',
    };
    const fresh = entry({
        summary: { text: 'AI 가 새로 쓴 요약', evidenceIds: ['e1'] },
        what: [sentence('새 무엇')],
    });
    const merged = preserveLockedFields(fresh, prevMaster);
    // summary 는 잠겨 있으니 이전 값
    assert.equal(merged.summary.text, '사용자가 직접 고친 요약');
    // what 은 안 잠겼으니 새 값
    assert.equal(merged.what[0].text, '새 무엇');
    // lockedFields 유지
    assert.deepEqual(merged.lockedFields, ['summary']);
});

test('preserveLockedFields: 이전 마스터에 없는 활동은 그대로', () => {
    const fresh = entry({ activityId: 'act-new' });
    const merged = preserveLockedFields(fresh, null);
    assert.equal(merged.activityId, 'act-new');
    assert.deepEqual(merged.lockedFields, []);
});

test('applyLockedFields: 전체 마스터에 보존 적용', () => {
    const prevMaster: MasterOutput = {
        kind: 'master',
        portfolioId: 'pf-1',
        entries: [entry({ title: { text: '고정 제목', evidenceIds: ['e1'] }, lockedFields: ['title'] })],
        generatedAt: '2026-09-20T00:00:00.000Z',
    };
    const newMaster: MasterOutput = {
        kind: 'master',
        portfolioId: 'pf-1',
        entries: [entry({ title: { text: '새 제목', evidenceIds: ['e1'] } })],
        generatedAt: '2026-09-21T00:00:00.000Z',
    };
    const applied = applyLockedFields(newMaster, prevMaster);
    assert.equal(applied.entries[0].title.text, '고정 제목');
});
