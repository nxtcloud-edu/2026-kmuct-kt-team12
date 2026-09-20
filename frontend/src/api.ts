// frontend/src/api.ts
// 모든 API 호출은 이 파일에만. VITE_USE_MOCK이 "true"면 src/mocks의 가짜 api로 교체.
// 로컬 기본은 mock.

import type {
  Connections,
  Job,
  JobKind,
  Keyword,
  Experience,
  Question,
  RecordItem,
  SiteInfo,
} from './types';
import { mockApi } from './mocks/mockApi';

export interface VerifyResult {
  github?: 'ok' | 'fail';
  notion?: 'ok' | 'fail';
  tistory?: 'ok' | 'fail';
}

export interface Api {
  createSession(): Promise<string>;
  verifyConnections(sessionId: string, conn: Connections): Promise<VerifyResult>;
  startJob(sessionId: string, kind: JobKind, connections?: Connections): Promise<string>;
  getJob(jobId: string): Promise<Job>;
  getRecords(sessionId: string): Promise<RecordItem[]>;
  patchRecord(sessionId: string, recordId: string, excluded: boolean): Promise<RecordItem>;
  getKeywords(sessionId: string): Promise<{ keywords: Keyword[]; experiences: Experience[] }>;
  getQuestions(sessionId: string): Promise<Question[]>;
  answerQuestion(
    sessionId: string,
    qid: string,
    answer: 'yes' | 'no' | 'skip',
    detail?: string,
  ): Promise<Question>;
  getSite(sessionId: string): Promise<SiteInfo | null>;
}

// 에러 응답 { error: { code, message } } 를 던진다.
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', '서버에 연결할 수 없습니다.', 0);
  }
  const text = await res.text();
  const data = text ? safeParse(text) : undefined;
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError(err?.code ?? 'error', err?.message ?? '요청에 실패했습니다.', res.status);
  }
  return data as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const realApi: Api = {
  async createSession() {
    const r = await req<{ sessionId: string }>('POST', '/sessions');
    return r.sessionId;
  },
  verifyConnections(sessionId, conn) {
    return req<VerifyResult>('POST', `/sessions/${sessionId}/connections/verify`, conn);
  },
  async startJob(sessionId, kind, connections) {
    const r = await req<{ jobId: string }>('POST', `/sessions/${sessionId}/jobs`, {
      kind,
      ...(connections ? { connections } : {}),
    });
    return r.jobId;
  },
  getJob(jobId) {
    return req<Job>('GET', `/jobs/${jobId}`);
  },
  getRecords(sessionId) {
    return req<RecordItem[]>('GET', `/sessions/${sessionId}/records`);
  },
  patchRecord(sessionId, recordId, excluded) {
    return req<RecordItem>('PATCH', `/sessions/${sessionId}/records/${recordId}`, { excluded });
  },
  getKeywords(sessionId) {
    return req('GET', `/sessions/${sessionId}/keywords`);
  },
  getQuestions(sessionId) {
    return req<Question[]>('GET', `/sessions/${sessionId}/questions`);
  },
  answerQuestion(sessionId, qid, answer, detail) {
    return req<Question>('POST', `/sessions/${sessionId}/questions/${qid}/answer`, {
      answer,
      ...(detail ? { detail } : {}),
    });
  },
  async getSite(sessionId) {
    try {
      return await req<SiteInfo>('GET', `/sessions/${sessionId}/site`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
};

const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false';

export const api: Api = USE_MOCK ? mockApi : realApi;
export const usingMock = USE_MOCK;
