// backend/src/ports.ts
// 외부 의존을 전부 인터페이스(포트)로 추상화한다.
// 실제 구현(AWS SDK, GitHub/Notion HTTP)은 이 포트 뒤에 둔다.
// 테스트와 로컬 개발은 인메모리/모킹 어댑터를 주입한다.

import type {
    Source,
    Artifact,
    Evidence,
    MasterOutput,
    TailoredOutput,
    Run,
} from '../../shared/types.js';

// ---------- Bedrock (AI) ----------
// 모든 AI 호출은 tool use(JSON 스키마 강제)로만 한다. 자유 텍스트를 파싱하지 않는다.
export interface BedrockToolCall<T> {
    /** 사람이 읽을 수 있는 프롬프트(시스템+유저 합본). 구현체가 Converse 블록으로 변환한다. */
    prompt: string;
    /** 강제할 tool 이름과 JSON 스키마. 구현체가 toolConfig 로 넘긴다. */
    toolName: string;
    schema: Record<string, unknown>;
    /** PDF/이미지 등 document/image 블록으로 넘길 첨부(선택). */
    attachments?: BedrockAttachment[];
}

export interface BedrockAttachment {
    kind: 'document' | 'image';
    /** S3 키 또는 바이트. 구현체가 알맞은 블록으로 변환한다. */
    s3Key?: string;
    bytes?: Uint8Array;
    mediaType?: string;
    name?: string;
}

export interface BedrockPort {
    /**
     * tool use 로 모델을 호출하고, 모델이 tool 에 넘긴 입력(JSON)을 T 로 돌려준다.
     * 스키마를 어기면 구현체가 재요청하거나 throw 한다.
     */
    invokeTool<T>(call: BedrockToolCall<T>): Promise<T>;
}

// ---------- Store (DynamoDB 단일 테이블) ----------
// PK=PF#{portfolioId}, SK 는 항목 종류별. ORM 을 쓰지 않는다(steering 금지 목록).
export interface StorePort {
    createPortfolio(portfolioId: string): Promise<void>;

    putSource(s: Source): Promise<void>;
    getSources(portfolioId: string): Promise<Source[]>;
    deleteSource(portfolioId: string, sourceId: string): Promise<void>;

    putArtifact(a: Artifact): Promise<void>;
    getArtifacts(portfolioId: string): Promise<Artifact[]>;

    putEvidence(portfolioId: string, e: Evidence[]): Promise<void>;
    getEvidence(portfolioId: string): Promise<Evidence[]>;

    putMaster(m: MasterOutput): Promise<void>;
    getMaster(portfolioId: string): Promise<MasterOutput | null>;

    putTailored(t: TailoredOutput): Promise<void>;
    getTailored(portfolioId: string, outputId: string): Promise<TailoredOutput | null>;
    getTailoredById(outputId: string): Promise<TailoredOutput | null>;
    listTailored(portfolioId: string): Promise<TailoredOutput[]>;

    putRun(r: Run): Promise<void>;
    getRun(runId: string): Promise<Run | null>;
    appendEvent(runId: string, message: string): Promise<void>;
    setRunStatus(runId: string, status: Run['status']): Promise<void>;
}

// ---------- Blob (S3) ----------
export interface BlobPort {
    /** 큰 원문 저장. 반환 key 는 Artifact.rawTextS3Key 로 쓴다. */
    putText(key: string, text: string): Promise<void>;
    getText(key: string): Promise<string>;
    /** 브라우저 직접 업로드용 presigned PUT URL. */
    presignPut(key: string, contentType: string): Promise<string>;
}

// ---------- Http (GitHub/Notion/웹 페이지 수집) ----------
export interface HttpResponse {
    status: number;
    body: string;
    headers: Record<string, string>;
}
export interface HttpPort {
    get(url: string, headers?: Record<string, string>): Promise<HttpResponse>;
}

// ---------- 단계 간 비동기 체이닝 (Step Functions 없이) ----------
// Lambda 를 기능별로 쪼갠 뒤, 한 단계가 끝나면 다음 단계 Lambda 를 비동기로 부른다.
// 실제 구현은 Lambda invoke(InvocationType='Event'), 테스트는 즉시 실행/기록으로 대체.
//
// 흐름:  API --collect--> Collector Lambda --pipeline--> Pipeline Lambda
//        API --tailor--> Pipeline Lambda (tailor 는 수집이 필요 없어 바로 파이프라인)
//
// mode 는 collect/pipeline 이 build 인지 refresh 인지 이어받는다(변경분만 재처리 판단).

export type PipelineMode = 'build' | 'refresh';

export interface CollectJob {
    kind: 'collect';
    mode: PipelineMode;
    portfolioId: string;
    runId: string;
}
export interface PipelineJob {
    kind: 'pipeline';
    mode: PipelineMode;
    portfolioId: string;
    runId: string;
}
export interface TailorJob {
    kind: 'tailor';
    portfolioId: string;
    runId: string;
    targetRole: string;
    jdText?: string;
    selectedActivityIds: string[];
}
export type Job = CollectJob | PipelineJob | TailorJob;

/** 다음 단계 Lambda 를 비동기로 부르는 경계. */
export interface JobInvoker {
    invoke(job: Job): Promise<void>;
}

// ---------- Clock / Id (결정성 위해 주입) ----------
export interface Clock {
    now(): string; // ISO 8601
}
export interface IdGen {
    next(prefix: string): string;
}

// ---------- 파이프라인 실행에 필요한 의존 묶음 ----------
export interface Deps {
    store: StorePort;
    blob: BlobPort;
    bedrock: BedrockPort;
    http: HttpPort;
    clock: Clock;
    id: IdGen;
    env: {
        EXTRACT_CONCURRENCY: number;
        BEDROCK_MODEL_ID: string;
        GITHUB_TOKEN?: string;
        NOTION_TOKEN?: string;
        RAWTEXT_SPILL_LIMIT: number; // 기본 40000
    };
}
