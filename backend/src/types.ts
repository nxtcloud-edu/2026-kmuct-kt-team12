// backend/src/types.ts
// 명세 4장 타입 정의 그대로 + export. 이 파일이 유일한 타입 출처.
// frontend는 이 파일을 `import type` 로만 가져온다.

export type SourceKind = 'github' | 'notion' | 'tistory';

export interface RecordItem {
  id: string;
  sessionId: string;
  source: SourceKind;
  title: string;
  timeStart?: string; // ISO 8601. 깃허브는 첫 커밋, 노션은 생성일, 티스토리는 작성일
  timeEnd?: string; // 깃허브는 마지막 커밋, 노션은 수정일
  body: string; // 40,000자 초과분은 잘라낸다
  url: string;
  excluded: boolean; // true면 4단계 이후에서 제외
  excludedReason?: string; // 자동 제외 사유 (예: "fork 저장소", "본문이 너무 짧음")
  meta: { languages?: string[]; commitCount?: number; commitMessages?: string[] };
}

export interface Experience {
  id: string;
  keywordId: string;
  text: string; // 예: "로그인 기능 구현"
  origin: 'record' | 'answer';
  recordIds: string[]; // origin이 record면 1개 이상
  quote?: string; // origin이 record면 필수. 기록 본문에 글자 그대로 존재하는 구절
  questionId?: string; // origin이 answer면 필수
}

export interface Keyword {
  id: string;
  name: string; // 예: "웹페이지 제작"
  experienceIds: string[];
}

export interface Question {
  id: string;
  keywordId: string;
  text: string; // 예: "웹페이지 제작에서 데이터베이스도 직접 구현하셨나요?"
  inferredExperience: string; // 예: "데이터베이스 구현"
  status: 'pending' | 'yes' | 'no' | 'skipped';
  detail?: string; // "예" 뒤의 한 줄 보충 (선택, 최대 200자)
}

export type JobKind = 'collect' | 'keywords' | 'questions' | 'generate';

export interface Job {
  id: string; // "{sessionId}.{랜덤}" 형식
  sessionId: string;
  kind: JobKind;
  status: 'running' | 'done' | 'failed';
  events: { at: string; message: string }[]; // 사용자에게 보이는 한국어 진행 메시지
}

export interface Connections {
  // 저장하지 않는다. collect 작업 payload로만 전달
  githubToken?: string;
  notionToken?: string;
  tistoryUrl?: string;
}

export interface SiteInfo {
  sessionId: string;
  s3Key: string;
  url: string;
  generatedAt: string;
}

export interface PortfolioContent {
  // 6단계 AI 출력
  headline: string;
  intro: string[]; // 3~4문장
  skills: { keywordId: string; summary: string }[];
  activities: { recordId: string; title: string; period: string; bullets: string[] }[];
}
