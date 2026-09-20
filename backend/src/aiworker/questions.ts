// backend/src/aiworker/questions.ts
// 5단계: 확인 질문 생성. 1회 호출, 최대 8개. 검증 후 pending 재생성(답한 질문 유지).

import { randomUUID } from 'node:crypto';
import type { Question, Keyword, Experience } from '../types.js';
import type { Store } from '../lib/db.js';
import { pk, SK, getKeywords, getExperiences, getQuestions, putQuestion } from '../lib/db.js';
import { converse, type ConverseDeps } from '../lib/bedrock.js';
import { QUESTIONS_SYSTEM, QUESTIONS_TOOL, questionsUser } from './prompts.js';
import { normWs } from './keywords.js';

interface QuestionsResult {
  questions: { keywordName: string; inferredExperience: string; question: string }[];
}

export interface QuestionsDeps {
  store: Store;
  sessionId: string;
  modelId: string;
  onEvent: (message: string) => Promise<void>;
  converseImpl?: <T>(args: Parameters<typeof converse>[0]) => Promise<T>;
  converseDeps?: ConverseDeps;
}

async function callConverse<T>(deps: QuestionsDeps, args: Parameters<typeof converse>[0]): Promise<T> {
  if (deps.converseImpl) return deps.converseImpl<T>(args);
  return converse<T>(args, deps.converseDeps ?? { modelId: deps.modelId });
}

export async function runQuestions(deps: QuestionsDeps): Promise<void> {
  const { store, sessionId } = deps;
  const [keywords, experiences] = await Promise.all([
    getKeywords(store, sessionId),
    getExperiences(store, sessionId),
  ]);
  if (keywords.length === 0) throw new Error('키워드가 없습니다.');

  const input = buildInput(keywords, experiences);
  const result = await callConverse<QuestionsResult>(deps, {
    system: QUESTIONS_SYSTEM,
    userText: questionsUser(input.map((k) => ({ name: k.name, experiences: k.expTexts }))),
    tool: QUESTIONS_TOOL,
    maxTokens: 1500,
  });

  const valid = validateQuestions(result.questions ?? [], keywords, experiences);

  // 기존 pending 질문 삭제, 답한 질문(yes/no/skipped)은 유지
  const existing = await getQuestions(store, sessionId);
  const pendingSks = existing.filter((q) => q.status === 'pending').map((q) => SK.q(q.id));
  await store.deleteMany(pk(sessionId), pendingSks);

  const nameToId = new Map(keywords.map((k) => [k.name, k.id]));
  let count = 0;
  for (const v of valid) {
    const q: Question = {
      id: `q-${randomUUID().slice(0, 8)}`,
      keywordId: nameToId.get(v.keywordName)!,
      text: v.question,
      inferredExperience: v.inferredExperience,
      status: 'pending',
    };
    await putQuestion(store, sessionId, q);
    count++;
  }
  await deps.onEvent(`확인 질문 ${count}개를 준비했습니다.`);
}

function buildInput(keywords: Keyword[], experiences: Experience[]) {
  const byKw = new Map<string, string[]>();
  for (const e of experiences) {
    const arr = byKw.get(e.keywordId) ?? [];
    arr.push(e.text);
    byKw.set(e.keywordId, arr);
  }
  return keywords.map((k) => ({ name: k.name, expTexts: byKw.get(k.id) ?? [] }));
}

// 검증: keywordName 실존, inferredExperience 가 기존 경험과 포함관계면 폐기, 8개 제한.
export function validateQuestions(
  questions: { keywordName: string; inferredExperience: string; question: string }[],
  keywords: Keyword[],
  experiences: Experience[],
): { keywordName: string; inferredExperience: string; question: string }[] {
  const validNames = new Set(keywords.map((k) => k.name));
  const existingTexts = experiences.map((e) => normWs(e.text));
  const seenInferred = new Set<string>();
  const out: typeof questions = [];

  for (const q of questions) {
    if (!q.keywordName || !q.inferredExperience || !q.question) continue;
    if (!validNames.has(q.keywordName)) continue;
    const inf = normWs(q.inferredExperience);
    // 기존 경험과 포함관계(양방향)면 중복으로 폐기
    const overlaps = existingTexts.some((t) => t.includes(inf) || inf.includes(t));
    if (overlaps) continue;
    // 유추 경험 자체 중복 제거
    if (seenInferred.has(inf)) continue;
    seenInferred.add(inf);
    out.push(q);
    if (out.length >= 8) break;
  }
  return out;
}
