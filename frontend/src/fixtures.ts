// src/fixtures.ts
// AWS 없이 브라우저에서 도는 데모용 가짜 데이터. shared/types.ts 계약을 그대로 따른다.
// 근거 추적(문장→원문 구절)을 보이려면 Evidence.quoteRef 가 Artifact 원문의 실제 위치를 가리켜야 한다.

import type {
    Artifact,
    Evidence,
    MasterOutput,
    TailoredOutput,
    Run,
    Source,
} from '@shared/types';

// ---------- 원문(Artifact) ----------
const ghRaw =
    '# 실시간 크롤러 프로젝트\n' +
    'REST API를 설계하고 대용량 크롤링의 병목을 해결했다. TypeScript와 Node.js로 구현했다.\n' +
    '동시성 제어로 처리량을 3배로 늘렸다.';

const blogRaw =
    '개발 스터디를 6개월간 운영했다. 매주 발표를 맡아 CS 지식을 공유했고, 회고를 남겼다.';

const notionRaw =
    '오늘 드디어 결제 모듈 API 다 짰음 ㅋㅋ 팀원들이랑 밤새서 테스트 다 통과시킴. 뿌듯하다';

export const fixtureArtifacts: Artifact[] = [
    {
        id: 'art-gh',
        sourceId: 'src-gh',
        rawText: ghRaw,
        contentHash: 'hash-gh',
        fetchedAt: '2026-03-01T00:00:00.000Z',
        meta: { title: 'user/realtime-crawler', languages: ['TypeScript'], commitRange: { first: '2026-01-05T00:00:00Z', last: '2026-03-01T00:00:00Z' } },
    },
    {
        id: 'art-blog',
        sourceId: 'src-blog',
        rawText: blogRaw,
        contentHash: 'hash-blog',
        fetchedAt: '2026-02-10T00:00:00.000Z',
        meta: { title: '개발 스터디 회고', publishedAt: '2026-02-10' },
    },
    {
        id: 'art-notion',
        sourceId: 'src-notion',
        rawText: notionRaw,
        contentHash: 'hash-notion',
        fetchedAt: '2026-04-01T00:00:00.000Z',
        meta: { title: '결제 모듈 메모' },
    },
];

// 원문 위치를 실제로 계산해 QuoteRef 를 만든다(코드가 start/end 계산 원칙과 동일).
function quoteRef(artifactId: string, raw: string, quote: string) {
    const start = raw.indexOf(quote);
    return { artifactId, quote, start, end: start + quote.length };
}

// ---------- 근거(Evidence) ----------
export const fixtureEvidence: Evidence[] = [
    {
        id: 'evd-1',
        field: 'what',
        claim: 'REST API를 설계하고 크롤링 병목을 해결했다',
        quoteRef: quoteRef('art-gh', ghRaw, 'REST API를 설계하고 대용량 크롤링의 병목을 해결했다'),
        activityId: 'act-crawler',
    },
    {
        id: 'evd-2',
        field: 'tech',
        claim: 'TypeScript와 Node.js를 사용했다',
        quoteRef: quoteRef('art-gh', ghRaw, 'TypeScript와 Node.js로 구현했다'),
        activityId: 'act-crawler',
    },
    {
        id: 'evd-3',
        field: 'result',
        claim: '동시성 제어로 처리량을 3배로 늘렸다',
        quoteRef: quoteRef('art-gh', ghRaw, '동시성 제어로 처리량을 3배로 늘렸다'),
        activityId: 'act-crawler',
    },
    {
        id: 'evd-4',
        field: 'what',
        claim: '개발 스터디를 6개월간 운영했다',
        quoteRef: quoteRef('art-blog', blogRaw, '개발 스터디를 6개월간 운영했다'),
        activityId: 'act-study',
    },
    {
        id: 'evd-5',
        field: 'how',
        claim: '매주 발표를 맡아 CS 지식을 공유했다',
        quoteRef: quoteRef('art-blog', blogRaw, '매주 발표를 맡아 CS 지식을 공유했고'),
        activityId: 'act-study',
    },
    {
        id: 'evd-6',
        field: 'result',
        claim: '결제 모듈 API를 완성하고 테스트를 통과시켰다',
        quoteRef: quoteRef('art-notion', notionRaw, '결제 모듈 API 다 짰음 ㅋㅋ 팀원들이랑 밤새서 테스트 다 통과시킴'),
        activityId: 'act-payment',
    },
];

// ---------- 마스터(MasterOutput) ----------
export const fixtureMaster: MasterOutput = {
    kind: 'master',
    portfolioId: 'pf-demo',
    generatedAt: '2026-04-02T00:00:00.000Z',
    entries: [
        {
            activityId: 'act-study',
            title: { text: '개발 스터디 운영', evidenceIds: ['evd-4'] },
            type: 'study',
            period: { start: '2026-01', end: '2026-06', inferred: true, evidenceIds: ['evd-4'] },
            affiliationRole: { text: '스터디 리더', evidenceIds: ['evd-4'] },
            summary: { text: '6개월간 개발 스터디를 운영하며 매주 발표를 맡았다', evidenceIds: ['evd-4', 'evd-5'] },
            what: [{ text: '개발 스터디를 6개월간 운영했다', evidenceIds: ['evd-4'] }],
            how: [{ text: '매주 발표를 맡아 CS 지식을 공유했다', evidenceIds: ['evd-5'] }],
            result: [],
            tech: [],
            outcome: null,
            sourceIds: ['art-blog'],
            lockedFields: [],
        },
        {
            activityId: 'act-crawler',
            title: { text: '실시간 크롤러 프로젝트', evidenceIds: ['evd-1'] },
            type: 'project',
            period: { start: '2026-01', end: '2026-03', inferred: false, evidenceIds: ['evd-1'] },
            affiliationRole: null,
            summary: { text: 'REST API를 설계하고 크롤링 병목을 해결한 프로젝트', evidenceIds: ['evd-1'] },
            what: [{ text: 'REST API를 설계하고 크롤링 병목을 해결했다', evidenceIds: ['evd-1'] }],
            how: [{ text: '동시성 제어를 적용했다', evidenceIds: ['evd-3'] }],
            result: [{ text: '처리량을 3배로 늘렸다', evidenceIds: ['evd-3'] }],
            tech: ['TypeScript', 'Node.js'],
            outcome: null,
            sourceIds: ['art-gh'],
            lockedFields: [],
        },
        {
            activityId: 'act-payment',
            title: { text: '결제 모듈 개발', evidenceIds: ['evd-6'] },
            type: 'project',
            period: { start: '2026-04', inferred: true, evidenceIds: ['evd-6'] },
            affiliationRole: null,
            summary: { text: '팀과 함께 결제 모듈 API를 완성하고 테스트를 통과시켰다', evidenceIds: ['evd-6'] },
            what: [{ text: '결제 모듈 API를 완성했다', evidenceIds: ['evd-6'] }],
            how: [],
            result: [{ text: '테스트를 전부 통과시켰다', evidenceIds: ['evd-6'] }],
            tech: [],
            outcome: null,
            sourceIds: ['art-notion'],
            lockedFields: [],
        },
    ],
};

// ---------- 맞춤본(TailoredOutput) ----------
export const fixtureTailored: TailoredOutput = {
    kind: 'tailored',
    id: 'out-backend',
    portfolioId: 'pf-demo',
    targetRole: '백엔드 개발자',
    jdText: 'REST API 설계, 대용량 처리, 협업 경험',
    competencies: [
        { name: 'REST API 설계', evidenceIds: ['evd-1'] },
        { name: '대용량/동시성 처리', evidenceIds: ['evd-3'] },
        { name: '협업', evidenceIds: ['evd-6'] },
        { name: 'CI/CD', evidenceIds: [] }, // 근거 없음 → 공백 리포트
    ],
    intro: [
        { text: 'REST API 설계와 대용량 처리 경험이 있는 백엔드 지원자입니다', evidenceIds: ['evd-1', 'evd-3'] },
        { text: '크롤링 병목을 동시성 제어로 해결해 처리량을 3배로 늘렸습니다', evidenceIds: ['evd-3'] },
        { text: '팀과 협업해 결제 모듈을 완성한 경험이 있습니다', evidenceIds: ['evd-6'] },
    ],
    entries: [
        {
            activityId: 'act-crawler',
            title: { text: '실시간 크롤러 — REST API 설계와 병목 해결', evidenceIds: ['evd-1'] },
            type: 'project',
            period: { start: '2026-01', end: '2026-03', inferred: false, evidenceIds: ['evd-1'] },
            affiliationRole: null,
            summary: { text: '기술적 문제 해결에 초점: 크롤링 병목을 동시성 제어로 풀었다', evidenceIds: ['evd-1', 'evd-3'] },
            what: [{ text: 'REST API를 설계하고 크롤링 병목을 해결했다', evidenceIds: ['evd-1'] }],
            how: [{ text: '동시성 제어를 적용했다', evidenceIds: ['evd-3'] }],
            result: [{ text: '처리량을 3배로 늘렸다', evidenceIds: ['evd-3'] }],
            tech: ['TypeScript', 'Node.js'],
            outcome: null,
            sourceIds: ['art-gh'],
            lockedFields: [],
        },
    ],
    basedOnMasterAt: '2026-04-02T00:00:00.000Z',
    generatedAt: '2026-04-02T01:00:00.000Z',
};

// ---------- 출처(Source) ----------
export const fixtureSources: Source[] = [
    { id: 'src-gh', portfolioId: 'pf-demo', kind: 'github', url: 'https://github.com/user/realtime-crawler', addedAt: '2026-03-01T00:00:00.000Z' },
    { id: 'src-blog', portfolioId: 'pf-demo', kind: 'web', url: 'https://blog.example.com/study-retro', addedAt: '2026-02-10T00:00:00.000Z' },
    { id: 'src-notion', portfolioId: 'pf-demo', kind: 'notion', url: 'https://notion.so/payment-memo-0123456789abcdef0123456789abcdef', addedAt: '2026-04-01T00:00:00.000Z' },
];

// ---------- 실행(Run) ----------
export const fixtureRunDone: Run = {
    id: 'run-demo',
    portfolioId: 'pf-demo',
    mode: 'build',
    status: 'done',
    events: [
        { at: '2026-04-02T00:00:01.000Z', message: '3개 출처를 수집했습니다' },
        { at: '2026-04-02T00:00:03.000Z', message: '근거 6개를 찾았습니다 (폐기 1개)' },
        { at: '2026-04-02T00:00:04.000Z', message: '2개 링크가 하나의 활동으로 합쳐졌습니다' },
        { at: '2026-04-02T00:00:05.000Z', message: '마스터 타임라인 3개 활동을 정리했습니다' },
    ],
};
