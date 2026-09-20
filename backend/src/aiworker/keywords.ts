// backend/src/aiworker/keywords.ts
// 4단계: 기록별 키워드/경험 추출 → quote 검증 → 키워드 통일 → 저장(record 재생성).

import { randomUUID } from 'node:crypto';
import type { Keyword, Experience } from '../types.js';
import type { Store } from '../lib/db.js';
import {
  pk,
  SK,
  getRecords,
  getKeywords,
  getExperiences,
  putKeyword,
  putExperience,
} from '../lib/db.js';
import { converse, type ConverseDeps } from '../lib/bedrock.js';
import { mapWithConcurrency } from './concurrency.js';
import {
  KEYWORDS_SYSTEM,
  KEYWORDS_TOOL,
  keywordsUser,
  UNIFY_SYSTEM,
  UNIFY_TOOL,
  unifyUser,
} from './prompts.js';

// 공백 정규화(비교용)
export function normWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

interface KeywordExtract {
  keywords: { keyword: string; experiences: { text: string; quote: string }[] }[];
}
interface UnifyResult {
  mapping: { from: string; to: string }[];
}

export interface KeywordsDeps {
  store: Store;
  sessionId: string;
  modelId: string;
  concurrency: number;
  onEvent: (message: string) => Promise<void>;
  // 테스트 주입: converse 대체
  converseImpl?: <T>(args: Parameters<typeof converse>[0]) => Promise<T>;
  converseDeps?: ConverseDeps;
}

async function callConverse<T>(deps: KeywordsDeps, args: Parameters<typeof converse>[0]): Promise<T> {
  if (deps.converseImpl) return deps.converseImpl<T>(args);
  return converse<T>(args, deps.converseDeps ?? { modelId: deps.modelId });
}

export async function runKeywords(deps: KeywordsDeps): Promise<void> {
  const { store, sessionId } = deps;
  const records = (await getRecords(store, sessionId)).filter((r) => !r.excluded);
  if (records.length === 0) throw new Error('제외되지 않은 기록이 없습니다.');

  // a) 기록별 1회 호출 (동시성 제한)
  const perRecord = await mapWithConcurrency(records, deps.concurrency, async (rec) => {
    const out = await callConverse<KeywordExtract>(deps, {
      system: KEYWORDS_SYSTEM,
      userText: keywordsUser(rec.title, rec.body),
      tool: KEYWORDS_TOOL,
      maxTokens: 2000,
    });
    return { rec, out };
  });

  // b) quote 검증 (공백 정규화 후 body 부분문자열이 아니면 폐기)
  interface RawExp {
    keyword: string;
    text: string;
    quote: string;
    recordId: string;
  }
  const rawExps: RawExp[] = [];
  let discarded = 0;
  for (const { rec, out } of perRecord) {
    const normBody = normWs(rec.body);
    for (const kw of out.keywords ?? []) {
      for (const exp of kw.experiences ?? []) {
        const q = normWs(exp.quote ?? '');
        if (q.length >= 10 && normBody.includes(q)) {
          rawExps.push({ keyword: kw.keyword.trim(), text: exp.text.trim(), quote: exp.quote, recordId: rec.id });
        } else {
          discarded++;
        }
      }
    }
  }
  if (discarded > 0) await deps.onEvent(`근거가 확인되지 않은 경험 ${discarded}개를 제외했습니다.`);
  if (rawExps.length === 0) throw new Error('근거가 확인된 경험이 없습니다.');

  // c) 키워드 통일 (최대 12개, 입력에 없던 이름은 무시)
  const uniqueNames = [...new Set(rawExps.map((e) => e.keyword))];
  let nameMap = new Map<string, string>();
  if (uniqueNames.length > 1) {
    try {
      const unify = await callConverse<UnifyResult>(deps, {
        system: UNIFY_SYSTEM,
        userText: unifyUser(uniqueNames),
        tool: UNIFY_TOOL,
        maxTokens: 1000,
      });
      const inputSet = new Set(uniqueNames);
      for (const m of unify.mapping ?? []) {
        if (inputSet.has(m.from)) nameMap.set(m.from, m.to.trim() || m.from);
      }
    } catch {
      // 통일 실패 시 원래 이름 유지
      nameMap = new Map();
    }
  }
  const repName = (name: string) => nameMap.get(name) ?? name;

  // 대표 이름 최대 12개로 제한: 초과분은 원래 이름 유지하되 12개 캡은 대표 이름 집합 기준
  const repNames = [...new Set(uniqueNames.map(repName))].slice(0, 12);
  const allowedRep = new Set(repNames);

  // d) 저장: 기존 origin=record 경험/키워드 정리 후 재생성. answer 경험/Question 유지.
  await clearRecordArtifacts(store, sessionId);

  // 키워드(대표 이름) 생성
  const keywordByName = new Map<string, Keyword>();
  for (const name of repNames) {
    const k: Keyword = { id: `kw-${randomUUID().slice(0, 8)}`, name, experienceIds: [] };
    keywordByName.set(name, k);
  }

  // 경험 생성 + 키워드에 연결
  const experiences: Experience[] = [];
  for (const e of rawExps) {
    const rep = repName(e.keyword);
    if (!allowedRep.has(rep)) continue; // 12개 초과 대표 이름은 제외
    const kw = keywordByName.get(rep)!;
    const exp: Experience = {
      id: `exp-${randomUUID().slice(0, 8)}`,
      keywordId: kw.id,
      text: e.text,
      origin: 'record',
      recordIds: [e.recordId],
      quote: e.quote,
    };
    kw.experienceIds.push(exp.id);
    experiences.push(exp);
  }

  // answer 경험은 그대로 유지되지만, 대응 키워드가 삭제되지 않도록 재연결 보장
  await reattachAnswerExperiences(store, sessionId, keywordByName);

  // 저장 (경험 없는 키워드는 저장하지 않음)
  for (const kw of keywordByName.values()) {
    if (kw.experienceIds.length > 0) await putKeyword(store, sessionId, kw);
  }
  for (const exp of experiences) await putExperience(store, sessionId, exp);

  const savedKeywords = [...keywordByName.values()].filter((k) => k.experienceIds.length > 0).length;
  await deps.onEvent(`기록 ${records.length}개에서 경험 ${experiences.length}개를 찾았습니다.`);
  await deps.onEvent(`키워드 ${savedKeywords}개로 정리했습니다.`);
}

// 기존 origin=record 경험과 키워드 전부 삭제 (answer 경험/Question 은 유지)
async function clearRecordArtifacts(store: Store, sessionId: string): Promise<void> {
  const [keywords, experiences] = await Promise.all([
    getKeywords(store, sessionId),
    getExperiences(store, sessionId),
  ]);
  const recordExpSks = experiences.filter((e) => e.origin === 'record').map((e) => SK.exp(e.id));
  const keywordSks = keywords.map((k) => SK.kw(k.id));
  await store.deleteMany(pk(sessionId), [...recordExpSks, ...keywordSks]);
}

// answer 경험이 참조하던 키워드가 새 키워드 집합에 없으면, 이름 기준으로 붙일 수 없으므로
// answer 경험의 keywordId 를 유지하되 해당 키워드를 되살린다.
// (명세: answer 경험/Question 유지. 키워드는 record 기준 재생성이므로 answer 전용 키워드도 보존.)
async function reattachAnswerExperiences(
  store: Store,
  sessionId: string,
  keywordByName: Map<string, Keyword>,
): Promise<void> {
  const experiences = await getExperiences(store, sessionId);
  const answerExps = experiences.filter((e) => e.origin === 'answer');
  if (answerExps.length === 0) return;
  // answer 경험이 참조하는 keywordId 별로 그 키워드를 되살려 experienceIds 에 포함
  const byKeywordId = new Map<string, Experience[]>();
  for (const e of answerExps) {
    const arr = byKeywordId.get(e.keywordId) ?? [];
    arr.push(e);
    byKeywordId.set(e.keywordId, arr);
  }
  for (const [keywordId, exps] of byKeywordId) {
    // 이미 새로 만든 키워드 중 같은 id 는 없으므로(신규 uuid), 원래 키워드를 복원한다.
    const existing = [...keywordByName.values()].find((k) => k.id === keywordId);
    if (existing) {
      for (const e of exps) if (!existing.experienceIds.includes(e.id)) existing.experienceIds.push(e.id);
    } else {
      // 원래 키워드를 store에서 찾을 수 없으므로(삭제됨) answer 전용 키워드를 새로 만든다.
      const revived: Keyword = {
        id: keywordId,
        name: '확인된 경험',
        experienceIds: exps.map((e) => e.id),
      };
      keywordByName.set(`__answer__${keywordId}`, revived);
    }
  }
}
