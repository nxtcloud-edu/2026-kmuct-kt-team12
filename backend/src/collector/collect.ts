// backend/src/collector/collect.ts
// 1·2단계 오케스트레이션 (AI 없음). 각 출처를 독립 실행, 하나 실패해도 나머지로 계속.
// 가져온 기록이 0개일 때만 실패. 재수집 시 같은 url 기록 덮어쓰되 사용자가 바꾼 excluded 유지.

import type { Connections } from '../types.js';
import type { Store } from '../lib/db.js';
import { pk, SK, getRecords } from '../lib/db.js';
import type { SafeFetchOptions } from '../lib/safeFetch.js';
import { toRecordItem, type RawRecord } from './normalize.js';
import { collectGithub } from './github.js';
import { collectNotion } from './notion.js';
import { collectTistory } from './tistory.js';

export interface CollectLimits {
  maxRepos: number;
  maxPosts: number;
  maxPages: number;
}

export interface CollectDeps {
  store: Store;
  sessionId: string;
  connections: Connections;
  limits: CollectLimits;
  // 진행 메시지 콜백 (Job.events 로 연결)
  onEvent: (message: string) => Promise<void>;
  // 테스트 주입: 각 출처 함수를 대체
  fetchOpts?: SafeFetchOptions;
  sources?: {
    github?: typeof collectGithub;
    notion?: typeof collectNotion;
    tistory?: typeof collectTistory;
  };
}

export async function runCollect(deps: CollectDeps): Promise<{ count: number }> {
  const { store, connections, limits, onEvent } = deps;
  const gh = deps.sources?.github ?? collectGithub;
  const nt = deps.sources?.notion ?? collectNotion;
  const ts = deps.sources?.tistory ?? collectTistory;

  const raws: RawRecord[] = [];

  if (connections.githubToken) {
    try {
      const r = await gh({ token: connections.githubToken, maxRepos: limits.maxRepos, fetchOpts: deps.fetchOpts });
      raws.push(...r);
      await onEvent(`깃허브 저장소 ${r.length}개를 읽었습니다.`);
    } catch (e) {
      await onEvent(`깃허브 연결에 실패했습니다. 나머지로 계속합니다. (${errLen(e)})`);
    }
  }

  if (connections.notionToken) {
    try {
      const r = await nt({ token: connections.notionToken, maxPages: limits.maxPages, fetchOpts: deps.fetchOpts });
      raws.push(...r);
      await onEvent(`노션 페이지 ${r.length}개를 가져왔습니다.`);
    } catch (e) {
      await onEvent(`노션 연결에 실패했습니다. 나머지로 계속합니다. (${errLen(e)})`);
    }
  }

  if (connections.tistoryUrl) {
    try {
      const r = await ts({ url: connections.tistoryUrl, maxPosts: limits.maxPosts, fetchOpts: deps.fetchOpts });
      raws.push(...r);
      await onEvent(`티스토리 글 ${r.length}개를 가져왔습니다.`);
    } catch (e) {
      await onEvent(`티스토리 연결에 실패했습니다. 나머지로 계속합니다. (${errLen(e)})`);
    }
  }

  if (raws.length === 0) {
    throw new Error('수집된 기록이 없습니다. 연결 정보와 권한을 확인하세요.');
  }

  const sessionId = deps.sessionId;
  const existing = await getRecords(store, sessionId);
  const byUrl = new Map(existing.map((r) => [r.url, r]));

  let count = 0;
  for (const raw of raws) {
    const item = toRecordItem(sessionId, raw);
    const prev = byUrl.get(item.url);
    if (prev) {
      // 사용자가 바꾼 excluded 값 유지 (자동 판정과 다를 수 있음)
      item.excluded = prev.excluded;
      if (prev.excluded && prev.excludedReason) item.excludedReason = prev.excludedReason;
      else if (!prev.excluded) delete item.excludedReason;
    }
    await store.put({ PK: pk(sessionId), SK: SK.rec(item.id), ...(item as unknown as Record<string, unknown>) });
    count++;
  }

  await onEvent(`총 ${count}개의 기록을 시간순으로 정리했습니다.`);
  return { count };
}

function errLen(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return `사유 길이 ${m.length}`;
}
