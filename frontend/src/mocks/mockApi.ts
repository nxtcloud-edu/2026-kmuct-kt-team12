// frontend/src/mocks/mockApi.ts
// 가짜 api. 기록 8개, 키워드 5개, 질문 6개. Job events 는 1초마다 하나씩 증가.
// 실제 api.ts 의 Api 인터페이스와 동일 시그니처.

import type {
  Api,
  VerifyResult,
} from '../api';
import type {
  Connections,
  Experience,
  Job,
  JobKind,
  Keyword,
  Question,
  RecordItem,
  SiteInfo,
} from '../types';

interface JobState {
  job: Job;
  messages: string[];
  startedAt: number;
  onDone: () => void;
}

const now = () => new Date().toISOString();

function makeRecords(sessionId: string): RecordItem[] {
  const base: Array<Partial<RecordItem> & { title: string; source: RecordItem['source'] }> = [
    { title: 'portfolio-site', source: 'github', timeStart: '2024-05-01', timeEnd: '2024-08-20' },
    { title: 'shopping-api', source: 'github', timeStart: '2024-03-10', timeEnd: '2024-06-01' },
    { title: '데이터 분석 회고', source: 'notion', timeStart: '2024-02-01', timeEnd: '2024-02-10' },
    { title: '스프링 부트로 REST API 만들기', source: 'tistory', timeStart: '2024-03-04' },
    { title: 'JPA 연관관계 정리', source: 'tistory', timeStart: '2024-03-12' },
    { title: 'algo-study', source: 'github', timeStart: '2023-11-01', timeEnd: '2024-01-15' },
    { title: '팀 프로젝트 노션 정리', source: 'notion', timeStart: '2023-09-01', timeEnd: '2023-12-01' },
    { title: 'forked-utils', source: 'github', excluded: true, excludedReason: 'fork 저장소' },
  ];
  return base.map((b, i) => ({
    id: `rec-${i}`,
    sessionId,
    source: b.source,
    title: b.title,
    timeStart: b.timeStart,
    timeEnd: b.timeEnd,
    body:
      `${b.title} 관련 활동 기록입니다. ` +
      '주요 작업 내용과 배운 점을 정리했습니다. '.repeat(6),
    url: `https://example.com/${i}`,
    excluded: b.excluded ?? false,
    excludedReason: b.excludedReason,
    meta: b.source === 'github' ? { languages: ['TypeScript'], commitCount: 24 } : {},
  }));
}

function makeKeywords(): { keywords: Keyword[]; experiences: Experience[] } {
  const defs: Array<{ name: string; exps: string[] }> = [
    { name: '웹페이지 제작', exps: ['로그인 기능 구현', '검색 기능 구현'] },
    { name: '데이터 분석', exps: ['로그 데이터 전처리', '시각화 대시보드 제작'] },
    { name: '백엔드 개발', exps: ['REST API 설계', 'JPA 연관관계 매핑'] },
    { name: '알고리즘', exps: ['그래프 탐색 문제 풀이'] },
    { name: '팀 프로젝트 관리', exps: ['일정 관리와 회고 진행'] },
  ];
  const keywords: Keyword[] = [];
  const experiences: Experience[] = [];
  defs.forEach((d, ki) => {
    const kid = `kw-${ki}`;
    const expIds: string[] = [];
    d.exps.forEach((text, ei) => {
      const eid = `exp-${ki}-${ei}`;
      expIds.push(eid);
      experiences.push({
        id: eid,
        keywordId: kid,
        text,
        origin: 'record',
        recordIds: [`rec-${ki}`],
        quote: `${text} 관련 근거 구절입니다.`,
      });
    });
    keywords.push({ id: kid, name: d.name, experienceIds: expIds });
  });
  return { keywords, experiences };
}

function makeQuestions(): Question[] {
  const defs: Array<[string, string, string]> = [
    ['kw-0', '웹페이지 제작에서 데이터베이스도 직접 설계하셨나요?', '데이터베이스 설계'],
    ['kw-0', '배포 자동화(CI/CD)를 구성하셨나요?', 'CI/CD 구성'],
    ['kw-1', '분석 결과를 이해관계자에게 발표하셨나요?', '분석 결과 발표'],
    ['kw-2', 'API 문서화를 진행하셨나요?', 'API 문서화'],
    ['kw-2', '인증/인가 로직을 구현하셨나요?', '인증 인가 구현'],
    ['kw-4', '스프린트 회고를 주도하셨나요?', '회고 주도'],
  ];
  return defs.map(([keywordId, text, inferred], i) => ({
    id: `q-${i}`,
    keywordId,
    text,
    inferredExperience: inferred,
    status: 'pending',
  }));
}

class MockStore {
  records: RecordItem[] = [];
  keywords: Keyword[] = [];
  experiences: Experience[] = [];
  questions: Question[] = [];
  site: SiteInfo | null = null;
  jobs = new Map<string, JobState>();
}

const stores = new Map<string, MockStore>();
const jobToSession = new Map<string, string>();

function store(sessionId: string): MockStore {
  let s = stores.get(sessionId);
  if (!s) {
    s = new MockStore();
    stores.set(sessionId, s);
  }
  return s;
}

const KIND_EVENTS: Record<JobKind, string[]> = {
  collect: ['깃허브 저장소 5개를 읽는 중', '노션 페이지 3개를 가져왔습니다', '티스토리 글 2개를 가져왔습니다', '총 8개의 기록을 정리했습니다.'],
  keywords: ['제외되지 않은 기록을 분석하는 중', '기록 7개에서 경험 8개를 찾았습니다', '키워드 5개로 정리했습니다.'],
  questions: ['키워드별 경험을 살펴보는 중', '확인 질문 6개를 준비했습니다.'],
  generate: ['확인된 경험을 반영하는 중', '포트폴리오 문장을 작성하는 중', '포트폴리오 사이트를 생성했습니다.'],
};

function applyJobEffects(sessionId: string, kind: JobKind): void {
  const s = store(sessionId);
  if (kind === 'collect') {
    s.records = makeRecords(sessionId);
  } else if (kind === 'keywords') {
    const k = makeKeywords();
    s.keywords = k.keywords;
    s.experiences = k.experiences;
  } else if (kind === 'questions') {
    if (s.questions.length === 0) s.questions = makeQuestions();
  } else if (kind === 'generate') {
    // yes 답변을 answer 경험으로 반영
    const yes = s.questions.filter((q) => q.status === 'yes');
    for (const q of yes) {
      if (s.experiences.some((e) => e.questionId === q.id)) continue;
      s.experiences.push({
        id: `exp-ans-${q.id}`,
        keywordId: q.keywordId,
        text: q.detail ? `${q.inferredExperience} (${q.detail})` : q.inferredExperience,
        origin: 'answer',
        recordIds: [],
        questionId: q.id,
      });
      const kw = s.keywords.find((k) => k.id === q.keywordId);
      if (kw) kw.experienceIds.push(`exp-ans-${q.id}`);
    }
    s.site = {
      sessionId,
      s3Key: `sites/${sessionId}/index.html`,
      url: `#mock-site/${sessionId}`,
      generatedAt: now(),
    };
  }
}

let seq = 0;

export const mockApi: Api = {
  async createSession() {
    const id = `mock-${Date.now()}-${seq++}`;
    store(id);
    return id;
  },

  async verifyConnections(_sessionId: string, conn: Connections): Promise<VerifyResult> {
    await delay(400);
    const out: VerifyResult = {};
    if (conn.githubToken) out.github = conn.githubToken.length > 3 ? 'ok' : 'fail';
    if (conn.notionToken) out.notion = conn.notionToken.length > 3 ? 'ok' : 'fail';
    if (conn.tistoryUrl) out.tistory = conn.tistoryUrl.includes('.') ? 'ok' : 'fail';
    return out;
  },

  async startJob(sessionId, kind) {
    const s = store(sessionId);
    for (const st of s.jobs.values()) {
      if (st.job.status === 'running') {
        throw mkErr('job_running', '이미 진행 중인 작업이 있습니다.', 409);
      }
    }
    const jobId = `${sessionId}.${(seq++).toString(36)}`;
    jobToSession.set(jobId, sessionId);
    const job: Job = {
      id: jobId,
      sessionId,
      kind,
      status: 'running',
      events: [{ at: now(), message: KIND_EVENTS[kind][0] }],
    };
    s.jobs.set(jobId, {
      job,
      messages: KIND_EVENTS[kind].slice(1),
      startedAt: Date.now(),
      onDone: () => applyJobEffects(sessionId, kind),
    });
    return jobId;
  },

  async getJob(jobId) {
    const sessionId = jobToSession.get(jobId);
    if (!sessionId) throw mkErr('job_not_found', '작업을 찾을 수 없습니다.', 404);
    const st = store(sessionId).jobs.get(jobId)!;
    // 1초당 하나씩 이벤트 추가
    const elapsedSec = Math.floor((Date.now() - st.startedAt) / 1000);
    const shouldHave = Math.min(st.messages.length, elapsedSec);
    while (st.job.events.length - 1 < shouldHave) {
      const next = st.messages[st.job.events.length - 1];
      if (!next) break;
      st.job.events.push({ at: now(), message: next });
    }
    if (st.job.status === 'running' && st.job.events.length - 1 >= st.messages.length) {
      st.job.status = 'done';
      st.onDone();
    }
    return structuredClone(st.job);
  },

  async getRecords(sessionId) {
    const recs = [...store(sessionId).records];
    recs.sort((a, b) => {
      if (!a.timeStart && !b.timeStart) return 0;
      if (!a.timeStart) return 1;
      if (!b.timeStart) return -1;
      return a.timeStart < b.timeStart ? 1 : -1;
    });
    return structuredClone(recs);
  },

  async patchRecord(sessionId, recordId, excluded) {
    const rec = store(sessionId).records.find((r) => r.id === recordId);
    if (!rec) throw mkErr('record_not_found', '기록을 찾을 수 없습니다.', 404);
    rec.excluded = excluded;
    if (!excluded) delete rec.excludedReason;
    return structuredClone(rec);
  },

  async getKeywords(sessionId) {
    const s = store(sessionId);
    return structuredClone({ keywords: s.keywords, experiences: s.experiences });
  },

  async getQuestions(sessionId) {
    return structuredClone(store(sessionId).questions);
  },

  async answerQuestion(sessionId, qid, answer, detail) {
    const q = store(sessionId).questions.find((x) => x.id === qid);
    if (!q) throw mkErr('question_not_found', '질문을 찾을 수 없습니다.', 404);
    q.status = answer === 'skip' ? 'skipped' : answer;
    if (q.status === 'yes' && detail?.trim()) q.detail = detail.trim().slice(0, 200);
    else delete q.detail;
    return structuredClone(q);
  },

  async getSite(sessionId) {
    return structuredClone(store(sessionId).site);
  },
};

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function mkErr(code: string, message: string, status: number): Error {
  // ApiError 를 import 하면 순환이 되므로 동일 형태 객체를 던진다.
  const e = new Error(message) as Error & { code: string; status: number };
  e.code = code;
  e.status = status;
  return e;
}
