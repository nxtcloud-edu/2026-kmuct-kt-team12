// shared/validators.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyQuote, validateEntry, validateTailored } from './validators.js';
import type {
    Artifact,
    ActivityEntry,
    Sentence,
    TailoredOutput,
} from './types.js';

// ---------- 픽스처 헬퍼 ----------
function makeArtifact(rawText: string): Artifact {
    return {
        id: 'art-1',
        sourceId: 'src-1',
        rawText,
        contentHash: 'hash',
        fetchedAt: '2026-09-20T00:00:00Z',
        meta: {},
    };
}

function sentence(text: string, evidenceIds: string[]): Sentence {
    return { text, evidenceIds };
}

function makeEntry(over: Partial<ActivityEntry> = {}): ActivityEntry {
    return {
        activityId: 'act-1',
        title: sentence('제목', ['e1']),
        type: 'project',
        period: null,
        affiliationRole: null,
        summary: sentence('요약', ['e1']),
        what: [sentence('무엇', ['e1'])],
        how: [sentence('어떻게', ['e1'])],
        result: [sentence('결과', ['e1'])],
        tech: ['TypeScript'],
        outcome: null,
        sourceIds: ['src-1'],
        lockedFields: [],
        ...over,
    };
}

// ---------- verifyQuote ----------
test('verifyQuote: 원문에 그대로 있으면 정확한 start/end 반환', () => {
    const art = makeArtifact('안녕하세요 저는 백엔드 개발자입니다');
    const ref = verifyQuote(art, '백엔드 개발자');
    assert.notEqual(ref, null);
    assert.equal(ref!.artifactId, 'art-1');
    assert.equal(art.rawText.slice(ref!.start, ref!.end), '백엔드 개발자');
});

test('verifyQuote: 공백/줄바꿈 차이를 정규화해서 매칭', () => {
    const art = makeArtifact('REST API를\n   설계하고   구현했다');
    // 인용문은 공백이 단일 스페이스
    const ref = verifyQuote(art, 'REST API를 설계하고 구현했다');
    assert.notEqual(ref, null);
    // 원문 기준 start/end 는 원문의 해당 구간을 감싸야 한다
    const slice = art.rawText.slice(ref!.start, ref!.end);
    assert.ok(slice.includes('REST API를'));
    assert.ok(slice.includes('구현했다'));
});

test('verifyQuote: 없는 인용이면 null', () => {
    const art = makeArtifact('실제로 한 일만 적혀 있다');
    const ref = verifyQuote(art, '하지 않은 일을 지어냈다');
    assert.equal(ref, null);
});

test('verifyQuote: 빈 인용이면 null', () => {
    const art = makeArtifact('내용');
    assert.equal(verifyQuote(art, '   '), null);
});

// ---------- validateEntry ----------
test('validateEntry: 모든 문장이 유효한 evidenceId를 가지면 위반 없음', () => {
    const entry = makeEntry();
    const v = validateEntry(entry, new Set(['e1']));
    assert.deepEqual(v, []);
});

test('validateEntry: evidenceIds 가 비면 위반', () => {
    const entry = makeEntry({ summary: sentence('요약', []) });
    const v = validateEntry(entry, new Set(['e1']));
    assert.equal(v.length, 1);
    assert.ok(v[0].includes('summary'));
    assert.ok(v[0].includes('비어'));
});

test('validateEntry: 집합 밖의 evidenceId 는 위반', () => {
    const entry = makeEntry({ what: [sentence('무엇', ['e1', 'e999'])] });
    const v = validateEntry(entry, new Set(['e1']));
    assert.equal(v.length, 1);
    assert.ok(v[0].includes('e999'));
});

// ---------- validateTailored ----------
function makeTailored(over: Partial<TailoredOutput> = {}): TailoredOutput {
    return {
        kind: 'tailored',
        id: 'tail-1',
        portfolioId: 'pf-1',
        targetRole: '백엔드 개발자',
        competencies: [{ name: 'REST API 설계', evidenceIds: ['e1'] }],
        intro: [sentence('자기소개', ['e1'])],
        entries: [makeEntry()],
        basedOnMasterAt: '2026-09-20T00:00:00Z',
        generatedAt: '2026-09-20T00:00:00Z',
        ...over,
    };
}

test('validateTailored: 허용 집합 안이면 위반 없음', () => {
    const out = makeTailored();
    const v = validateTailored(out, new Set(['e1']));
    assert.deepEqual(v, []);
});

test('validateTailored: intro 가 허용 집합 밖이면 위반', () => {
    const out = makeTailored({ intro: [sentence('부풀린 소개', ['e-fake'])] });
    const v = validateTailored(out, new Set(['e1']));
    assert.ok(v.some((m) => m.includes('intro') && m.includes('e-fake')));
});

test('validateTailored: entry 가 허용 집합 밖의 근거를 쓰면 위반', () => {
    const out = makeTailored({
        entries: [makeEntry({ result: [sentence('과장된 결과', ['e-out'])] })],
    });
    const v = validateTailored(out, new Set(['e1']));
    assert.ok(v.some((m) => m.includes('e-out')));
});

test('validateTailored: 빈 competency evidenceIds 는 허용(공백 리포트용)', () => {
    const out = makeTailored({
        competencies: [{ name: '없는 역량', evidenceIds: [] }],
    });
    const v = validateTailored(out, new Set(['e1']));
    assert.deepEqual(v, []);
});
