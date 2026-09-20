// backend/src/aiworker/prompts.ts
// 프롬프트 문자열 + tool 스키마를 한 파일에 모은다.
// 수집 본문은 <record> 태그로 감싸고, system에 RECORD_GUARD를 넣는다(bedrock.ts).

import { RECORD_GUARD } from '../lib/bedrock.js';
import type { ToolSpec } from '../lib/bedrock.js';

// ── 4단계: 기록 하나에서 키워드+경험 추출 ──
export const KEYWORDS_SYSTEM =
  RECORD_GUARD +
  '\n너는 채용 포트폴리오를 돕는 분석가다. 주어진 활동 기록 하나를 읽고 상위 활동 범주(keyword)와 ' +
  '그 안에서 실제로 수행한 구체적 경험(experience)을 뽑는다. ' +
  'keyword 예: 웹페이지 제작, 데이터 분석, 팀 프로젝트 관리. ' +
  'experience 는 기록에 근거가 있는 구체적인 일이어야 한다. ' +
  'quote 는 기록 본문에서 글자 그대로 복사한 10자 이상의 구절이어야 한다. 추측·감상·칭찬은 넣지 않는다.';

export const KEYWORDS_TOOL: ToolSpec = {
  name: 'record_keywords',
  description: '기록에서 추출한 키워드와 경험 목록',
  schema: {
    type: 'object',
    properties: {
      keywords: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: '상위 활동 범주' },
            experiences: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string', description: '구체적 경험(예: 로그인 기능 구현)' },
                  quote: { type: 'string', description: '기록 본문에서 글자 그대로 복사한 10자 이상 구절' },
                },
                required: ['text', 'quote'],
              },
            },
          },
          required: ['keyword', 'experiences'],
        },
      },
    },
    required: ['keywords'],
  },
};

export function keywordsUser(recordTitle: string, recordBody: string): string {
  return `다음 활동 기록을 분석하라.\n\n제목: ${recordTitle}\n\n<record>\n${recordBody}\n</record>`;
}

// ── 4단계 c: 키워드 통일 ──
export const UNIFY_SYSTEM =
  '너는 활동 범주 이름들을 정리하는 편집자다. 주어진 키워드 이름 목록에서 같은 뜻끼리 묶어 ' +
  '대표 이름을 정한다. 결과 대표 이름은 최대 12개를 넘지 않는다. ' +
  '입력에 없던 이름을 새로 만들지 않는다.';

export const UNIFY_TOOL: ToolSpec = {
  name: 'unify_keywords',
  description: '원본 키워드 이름 → 대표 이름 매핑',
  schema: {
    type: 'object',
    properties: {
      mapping: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string', description: '입력에 있던 원본 키워드 이름' },
            to: { type: 'string', description: '대표 이름' },
          },
          required: ['from', 'to'],
        },
      },
    },
    required: ['mapping'],
  },
};

export function unifyUser(names: string[]): string {
  return `다음 키워드 이름들을 같은 뜻끼리 묶어라.\n\n${names.map((n) => `- ${n}`).join('\n')}`;
}

// ── 5단계: 확인 질문 생성 ──
export const QUESTIONS_SYSTEM =
  '너는 지원자의 숨은 경험을 확인하는 면접관이다. 각 키워드에서 흔히 함께 수행되지만 ' +
  '현재 경험 목록에 없는 경험을 하나씩 고른다. 질문은 예/아니오로 답할 수 있는 한 문장이어야 한다. ' +
  '이미 목록에 있는 경험은 묻지 않는다. 최대 8개.';

export const QUESTIONS_TOOL: ToolSpec = {
  name: 'make_questions',
  description: '키워드별 확인 질문 목록',
  schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            keywordName: { type: 'string', description: '기존 키워드 이름 중 하나' },
            inferredExperience: { type: 'string', description: '유추한(목록에 없는) 경험' },
            question: { type: 'string', description: '예/아니오로 답하는 한 문장 질문' },
          },
          required: ['keywordName', 'inferredExperience', 'question'],
        },
      },
    },
    required: ['questions'],
  },
};

export function questionsUser(keywords: { name: string; experiences: string[] }[]): string {
  const lines = keywords
    .map((k) => `키워드: ${k.name}\n  경험: ${k.experiences.join(', ') || '(없음)'}`)
    .join('\n');
  return `다음은 키워드별 현재 경험 목록이다. 각 키워드에서 목록에 없는 경험을 질문으로 만들어라.\n\n${lines}`;
}

// ── 6단계 a: detail 다듬기 ──
export const REFINE_SYSTEM =
  '너는 한 줄 경험 문장을 다듬는 편집자다. 유추 경험과 사용자의 보충 설명을 합쳐 ' +
  '한국어 한 문장(60자 이내)으로 만든다. 입력에 없는 기술명·수치를 새로 넣지 않는다.';

export const REFINE_TOOL: ToolSpec = {
  name: 'refine_experience',
  description: '다듬은 한 문장 경험',
  schema: {
    type: 'object',
    properties: { text: { type: 'string', description: '다듬은 한 문장 경험(60자 이내)' } },
    required: ['text'],
  },
};

export function refineUser(inferred: string, detail: string): string {
  return `유추 경험: ${inferred}\n보충 설명: ${detail}\n\n둘을 합쳐 한 문장으로 다듬어라.`;
}

// ── 6단계 b: 포트폴리오 본문 작성 ──
export const GENERATE_SYSTEM =
  '너는 포트폴리오 작성자다. 확인된 경험 자산과 기록만으로 포트폴리오 문장을 쓴다. ' +
  '문체: 한국어, 간결한 서술체, 한 문장 60자 이내, 감탄·감상 제거. ' +
  '고유명사와 수치는 입력 그대로 사용한다. ' +
  '입력에 없는 기술명·수치·수상·역할을 새로 만들지 않는다. ' +
  'id 값(keywordId, recordId)은 입력에서 받은 것을 그대로 사용한다.';

export const GENERATE_TOOL: ToolSpec = {
  name: 'write_portfolio',
  description: '포트폴리오 본문(PortfolioContent)',
  schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: '한 줄 헤드라인' },
      intro: { type: 'array', items: { type: 'string' }, description: '소개 3~4문장' },
      skills: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            keywordId: { type: 'string' },
            summary: { type: 'string' },
          },
          required: ['keywordId', 'summary'],
        },
      },
      activities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            recordId: { type: 'string' },
            title: { type: 'string' },
            period: { type: 'string' },
            bullets: { type: 'array', items: { type: 'string' } },
          },
          required: ['recordId', 'title', 'period', 'bullets'],
        },
      },
    },
    required: ['headline', 'intro', 'skills', 'activities'],
  },
};

export interface GenerateInputKeyword {
  keywordId: string;
  name: string;
  experiences: { text: string; origin: 'record' | 'answer' }[];
}
export interface GenerateInputRecord {
  recordId: string;
  title: string;
  period: string;
}

export function generateUser(
  keywords: GenerateInputKeyword[],
  records: GenerateInputRecord[],
): string {
  const kw = keywords
    .map(
      (k) =>
        `- [keywordId=${k.keywordId}] ${k.name}\n` +
        k.experiences.map((e) => `    · (${e.origin}) ${e.text}`).join('\n'),
    )
    .join('\n');
  const rec = records
    .map((r) => `- [recordId=${r.recordId}] ${r.title} (${r.period})`)
    .join('\n');
  return `아래 키워드/경험과 기록만으로 포트폴리오를 작성하라. skills.keywordId 와 activities.recordId 는 반드시 아래 대괄호 안 값을 그대로 쓴다.\n\n[키워드와 경험]\n${kw}\n\n[기록]\n${rec}`;
}
