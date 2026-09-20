// shared/types.ts
// 이 파일 하나가 팀 전체의 계약이다. 프론트와 백엔드가 같은 파일을 import한다.
// 정의는 docs/design.md 5장 원문 그대로다. 모듈 공개를 위한 export 키워드만 더했다.

// ---------- 입력 ----------
export type SourceKind = 'github' | 'notion' | 'tistory' | 'web' | 'file';

export interface Source {
    id: string;
    portfolioId: string;
    kind: SourceKind;
    url?: string;              // kind !== 'file'
    s3Key?: string;            // kind === 'file'
    fileName?: string;
    addedAt: string;           // ISO 8601
}

// ---------- 1계층: Artifact (원문) ----------
export interface Artifact {
    id: string;
    sourceId: string;
    rawText: string;              // 4만 자 초과 시 S3에 두고 rawTextS3Key 사용
    rawTextS3Key?: string;
    contentHash: string;          // sha256(rawText), 갱신 시 변경 감지
    fetchedAt: string;
    meta: {
        title?: string;
        publishedAt?: string;                           // 글 작성일
        commitRange?: { first: string; last: string };  // 깃허브
        languages?: string[];                           // 깃허브
    };
}

// ---------- 2계층: Evidence (근거) ----------
export type EvidenceField =
    | 'title' | 'type' | 'period' | 'affiliation' | 'role'
    | 'what' | 'how' | 'result' | 'tech' | 'outcome';

export interface QuoteRef {
    artifactId: string;
    quote: string;        // 원문 그대로. rawText.includes(quote)가 참이어야 저장
    start: number;        // rawText 내 위치. 검증 코드가 계산(AI가 내지 않음)
    end: number;
}

export interface Evidence {
    id: string;
    field: EvidenceField;
    claim: string;          // 인용에서 읽어낸 사실, 중립 문체 한 문장
    quoteRef: QuoteRef;
    activityId?: string; // 3단계에서 채워짐
}

// ---------- 3계층: Output ----------
export interface Sentence {
    text: string;
    evidenceIds: string[];         // 최소 1개. 비면 검증 실패
}

export interface Period {
    start?: string;       // YYYY-MM
    end?: string;
    inferred: boolean;
    evidenceIds: string[];
}

export interface ActivityEntry {                   // 기획서의 "하나의 폼"
    activityId: string;
    title: Sentence;
    type: 'project' | 'club' | 'contest' | 'intern' | 'study' | 'etc';
    period: Period | null;
    affiliationRole: Sentence | null;
    summary: Sentence;
    what: Sentence[];
    how: Sentence[];
    result: Sentence[];
    tech: string[];
    outcome: Sentence[] | null;                  // null 이면 회색 "성과 미입력"
    sourceIds: string[];
    lockedFields: string[];                // 사용자가 직접 고친 칸. 갱신 때 덮어쓰지 않음
}

export interface MasterOutput {
    kind: 'master';
    portfolioId: string;
    entries: ActivityEntry[];              // period.start 기준 정렬
    generatedAt: string;
}

export interface Competency {
    name: string;                            // 예: "REST API 설계"
    evidenceIds: string[];         // 비어 있으면 공백 리포트에 들어감
}

export interface TailoredOutput {
    kind: 'tailored';
    id: string;
    portfolioId: string;
    targetRole: string;
    jdText?: string;
    competencies: Competency[];
    intro: Sentence[];             // 상단 자기소개 3~4문장
    entries: ActivityEntry[];      // 선택분만, 관련도순, 재서술됨
    basedOnMasterAt: string;       // 마스터가 이보다 새로우면 "원본이 바뀜" 표시
    generatedAt: string;
}

// ---------- 실행 상태 (정리 중 화면) ----------
export interface Run {
    id: string;
    portfolioId: string;
    mode: 'build' | 'refresh' | 'tailor';
    status: 'running' | 'done' | 'failed';
    events: { at: string; message: string }[];       // "3개 링크가 하나의 활동으로 합쳐졌습니다"
}

// ---------- 경험 매칭 (AI 챗봇) ----------
export interface MatchQuestion {
    id: string;
    activityId: string;
    question: string;
    suggestedKeyword: string;     // 예: "Database 구현"
    status: 'pending' | 'confirmed' | 'denied';
    userAnswer?: string;
}

export interface MatchSession {
    id: string;
    portfolioId: string;
    questions: MatchQuestion[];
    status: 'active' | 'done';
    createdAt: string;
}
