// backend/src/aiworker/generate.ts
// 6단계: yes 질문 → answer 경험 변환, PortfolioContent 작성, 검증, siteTemplate, S3 업로드, SiteInfo 저장.

import { randomUUID } from 'node:crypto';
import type {
  PortfolioContent,
  Experience,
  RecordItem,
  SiteInfo,
} from '../types.js';
import type { Store } from '../lib/db.js';
import {
  getRecords,
  getKeywords,
  getExperiences,
  getQuestions,
  putExperience,
  putSite,
} from '../lib/db.js';
import { converse, type ConverseDeps } from '../lib/bedrock.js';
import { siteKey } from '../lib/s3.js';
import { renderSite } from './siteTemplate.js';
import {
  REFINE_SYSTEM,
  REFINE_TOOL,
  refineUser,
  GENERATE_SYSTEM,
  GENERATE_TOOL,
  generateUser,
  type GenerateInputKeyword,
  type GenerateInputRecord,
} from './prompts.js';

export interface GenerateDeps {
  store: Store;
  sessionId: string;
  modelId: string;
  bucket: string;
  sitePublicBase?: string;
  apiPublicBase: string;
  onEvent: (message: string) => Promise<void>;
  // S3 업로드 (테스트 주입)
  uploadHtml: (sessionId: string, html: string) => Promise<string>;
  converseImpl?: <T>(args: Parameters<typeof converse>[0]) => Promise<T>;
  converseDeps?: ConverseDeps;
}

async function callConverse<T>(deps: GenerateDeps, args: Parameters<typeof converse>[0]): Promise<T> {
  if (deps.converseImpl) return deps.converseImpl<T>(args);
  return converse<T>(args, deps.converseDeps ?? { modelId: deps.modelId });
}

export async function runGenerate(deps: GenerateDeps): Promise<void> {
  const { store, sessionId } = deps;

  // a) yes 질문 → answer 경험 (이미 변환된 것은 건너뜀)
  await convertYesQuestions(deps);

  const [records, keywords, experiences] = await Promise.all([
    getRecords(store, sessionId),
    getKeywords(store, sessionId),
    getExperiences(store, sessionId),
  ]);
  if (experiences.length === 0) throw new Error('경험이 없습니다.');

  const includedRecords = records.filter((r) => !r.excluded);

  // b) PortfolioContent 1회 호출
  const kwInput: GenerateInputKeyword[] = keywords.map((k) => ({
    keywordId: k.id,
    name: k.name,
    experiences: k.experienceIds
      .map((id) => experiences.find((e) => e.id === id))
      .filter((e): e is Experience => !!e)
      .map((e) => ({ text: e.text, origin: e.origin })),
  }));
  const recInput: GenerateInputRecord[] = includedRecords.map((r) => ({
    recordId: r.id,
    title: r.title,
    period: periodOf(r),
  }));

  const content = await callConverse<PortfolioContent>(deps, {
    system: GENERATE_SYSTEM,
    userText: generateUser(kwInput, recInput),
    tool: GENERATE_TOOL,
    maxTokens: 3000,
  });

  // c) 코드 검증
  const cleaned = validateContent(content, keywords, includedRecords);

  // d) siteTemplate 로 HTML 생성
  const html = renderSite({
    content: cleaned,
    keywords,
    experiences,
    records: includedRecords,
  });

  // e) S3 업로드
  const key = await deps.uploadHtml(sessionId, html);

  // f) SiteInfo 저장
  const url = deps.sitePublicBase
    ? `${trimSlash(deps.sitePublicBase)}/${siteKey(sessionId)}`
    : `${trimSlash(deps.apiPublicBase)}/sites/${sessionId}`;
  const site: SiteInfo = {
    sessionId,
    s3Key: key,
    url,
    generatedAt: new Date().toISOString(),
  };
  await putSite(store, site);
  await deps.onEvent('포트폴리오 사이트를 생성했습니다.');
}

async function convertYesQuestions(deps: GenerateDeps): Promise<void> {
  const { store, sessionId } = deps;
  const [questions, experiences] = await Promise.all([
    getQuestions(store, sessionId),
    getExperiences(store, sessionId),
  ]);
  const alreadyByQ = new Set(
    experiences.filter((e) => e.origin === 'answer' && e.questionId).map((e) => e.questionId!),
  );
  const yesQuestions = questions.filter((q) => q.status === 'yes' && !alreadyByQ.has(q.id));
  let added = 0;
  for (const q of yesQuestions) {
    let text = q.inferredExperience;
    if (q.detail && q.detail.trim()) {
      try {
        const refined = await callConverse<{ text: string }>(deps, {
          system: REFINE_SYSTEM,
          userText: refineUser(q.inferredExperience, q.detail),
          tool: REFINE_TOOL,
          maxTokens: 300,
        });
        if (refined.text && refined.text.trim()) text = refined.text.trim();
      } catch {
        // 다듬기 실패 시 inferredExperience 사용
      }
    }
    const exp: Experience = {
      id: `exp-${randomUUID().slice(0, 8)}`,
      keywordId: q.keywordId,
      text,
      origin: 'answer',
      recordIds: [],
      questionId: q.id,
    };
    await putExperience(store, sessionId, exp);
    added++;
  }
  if (added > 0) await deps.onEvent(`확인된 경험 ${added}개를 포트폴리오에 반영했습니다.`);
}

// 기간 문자열
export function periodOf(r: RecordItem): string {
  const s = r.timeStart?.slice(0, 10);
  const e = r.timeEnd?.slice(0, 10);
  if (s && e && s !== e) return `${s} ~ ${e}`;
  if (s) return s;
  if (e) return e;
  return '기간 미상';
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

// 영문 단어(기술명 후보) 추출
export function englishWords(s: string): string[] {
  return (s.match(/[A-Za-z][A-Za-z0-9+.#-]*/g) ?? []).filter((w) => w.length >= 2);
}

// 검증: activities.recordId / skills.keywordId 실존, bullets의 영문 기술명이 입력 텍스트에 없으면 삭제.
export function validateContent(
  content: PortfolioContent,
  keywords: { id: string }[],
  records: { id: string; title: string; body: string }[],
): PortfolioContent {
  const kwIds = new Set(keywords.map((k) => k.id));
  const recIds = new Set(records.map((r) => r.id));

  // 입력 텍스트 전체(제목+본문)에서 영문 단어 집합 (소문자 비교)
  const inputWords = new Set<string>();
  for (const r of records) {
    for (const w of englishWords(`${r.title} ${r.body}`)) inputWords.add(w.toLowerCase());
  }

  const skills = (content.skills ?? []).filter((s) => kwIds.has(s.keywordId));

  const activities = (content.activities ?? [])
    .filter((a) => recIds.has(a.recordId))
    .map((a) => {
      const bullets = a.bullets.filter((b) => {
        const techs = englishWords(b);
        // bullet 안 모든 영문 기술명이 입력에 존재해야 유지
        return techs.every((t) => inputWords.has(t.toLowerCase()));
      });
      return { ...a, bullets };
    });

  return { ...content, skills, activities };
}
