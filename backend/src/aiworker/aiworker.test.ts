import { describe, it, expect, vi } from 'vitest';
import { runKeywords } from './keywords.js';
import { runQuestions, validateQuestions } from './questions.js';
import { runGenerate, validateContent, englishWords, periodOf } from './generate.js';
import { renderSite } from './siteTemplate.js';
import { mapWithConcurrency } from './concurrency.js';
import { MemoryStore, pk, SK, getKeywords, getExperiences, getQuestions } from '../lib/db.js';
import type { RecordItem, Keyword, Experience, PortfolioContent } from '../types.js';

function seedRecord(store: MemoryStore, sid: string, r: Partial<RecordItem> & { id: string; body: string }) {
  const rec: RecordItem = {
    sessionId: sid,
    source: 'github',
    title: r.id,
    url: `https://x/${r.id}`,
    excluded: false,
    meta: {},
    ...r,
  } as RecordItem;
  return store.put({ PK: pk(sid), SK: SK.rec(rec.id), ...rec });
}

describe('concurrency', () => {
  it('순서 유지 + 최대 동시 실행 제한', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('keywords: quote 검증 + 통일', () => {
  it('body에 없는 quote는 폐기, 모르는 이름 매핑 무시', async () => {
    const store = new MemoryStore();
    const sid = 's';
    await store.put({ PK: pk(sid), SK: SK.meta(), sessionId: sid });
    await seedRecord(store, sid, {
      id: 'r1',
      body: '로그인 기능을 직접 구현했다. 세션 관리도 붙였다. 데이터 분석 대시보드도 만들었다.',
    });

    const converseImpl = vi.fn(async (args: any) => {
      if (args.tool.name === 'record_keywords') {
        return {
          keywords: [
            {
              keyword: '웹 개발',
              experiences: [
                { text: '로그인 구현', quote: '로그인 기능을 직접 구현했다' }, // 존재 → 유지
                { text: '결제 연동', quote: '토스페이먼츠로 결제를 붙였다' }, // 본문에 없음 → 폐기
              ],
            },
            {
              keyword: '데이터',
              experiences: [
                { text: '대시보드 제작', quote: '데이터 분석 대시보드도 만들었다' }, // 존재 → 유지
              ],
            },
          ],
        };
      }
      if (args.tool.name === 'unify_keywords') {
        return {
          mapping: [
            { from: '웹 개발', to: '웹페이지 제작' },
            { from: '데이터', to: '데이터 분석' },
            { from: '존재하지않는이름', to: '유령' }, // 입력에 없음 → 무시
          ],
        };
      }
      throw new Error('unexpected tool');
    });

    const events: string[] = [];
    await runKeywords({
      store, sessionId: sid, modelId: 'us.x', concurrency: 3,
      onEvent: async (m) => { events.push(m); },
      converseImpl: converseImpl as any,
    });

    const kws = await getKeywords(store, sid);
    const exps = await getExperiences(store, sid);
    // 결제 연동(quote 없음) 폐기 → 로그인 구현 + 대시보드 제작 2개
    expect(exps).toHaveLength(2);
    expect(exps.map((e) => e.text).sort()).toEqual(['대시보드 제작', '로그인 구현']);
    expect(exps.every((e) => e.origin === 'record')).toBe(true);
    // 통일 적용된 대표 이름
    expect(kws.map((k) => k.name).sort()).toEqual(['데이터 분석', '웹페이지 제작']);
    expect(events.some((e) => e.includes('제외'))).toBe(true);
  });

  it('재실행 시 record 경험만 재생성, answer 경험 유지', async () => {
    const store = new MemoryStore();
    const sid = 's';
    await store.put({ PK: pk(sid), SK: SK.meta(), sessionId: sid });
    await seedRecord(store, sid, { id: 'r1', body: '데이터 파이프라인을 구축하고 배포했다.' });

    // 기존 answer 경험 + 그 키워드
    const answerExp: Experience = {
      id: 'exp-ans', keywordId: 'kw-old', text: '확인된 경험', origin: 'answer', recordIds: [], questionId: 'q1',
    };
    await store.put({ PK: pk(sid), SK: SK.exp(answerExp.id), ...answerExp });
    await store.put({ PK: pk(sid), SK: SK.kw('kw-old'), id: 'kw-old', name: '옛키워드', experienceIds: ['exp-ans'] });

    const converseImpl = vi.fn(async (args: any) => {
      if (args.tool.name === 'record_keywords') {
        return { keywords: [{ keyword: '데이터', experiences: [{ text: '파이프라인 구축', quote: '데이터 파이프라인을 구축하고 배포했다' }] }] };
      }
      return { mapping: [] };
    });

    await runKeywords({
      store, sessionId: sid, modelId: 'us.x', concurrency: 3,
      onEvent: async () => {}, converseImpl: converseImpl as any,
    });

    const exps = await getExperiences(store, sid);
    // answer 경험 유지 + 새 record 경험
    expect(exps.some((e) => e.origin === 'answer' && e.id === 'exp-ans')).toBe(true);
    expect(exps.some((e) => e.origin === 'record' && e.text === '파이프라인 구축')).toBe(true);
  });
});

describe('questions 검증', () => {
  const keywords: Keyword[] = [{ id: 'k1', name: '웹', experienceIds: [] }];
  const experiences: Experience[] = [
    { id: 'e1', keywordId: 'k1', text: '로그인 구현', origin: 'record', recordIds: ['r1'] },
  ];

  it('모르는 키워드/기존경험 포함/중복/8개초과 폐기', () => {
    const raw = [
      { keywordName: '웹', inferredExperience: '데이터베이스 구현', question: 'DB도?' }, // 유지
      { keywordName: '없음', inferredExperience: '캐시', question: '캐시?' }, // 키워드 없음 폐기
      { keywordName: '웹', inferredExperience: '로그인', question: '로그인?' }, // 기존경험 포함관계 폐기
      { keywordName: '웹', inferredExperience: '데이터베이스 구현', question: '중복?' }, // 중복 폐기
      ...Array.from({ length: 10 }, (_, i) => ({ keywordName: '웹', inferredExperience: `기능${i}`, question: `q${i}?` })),
    ];
    const out = validateQuestions(raw, keywords, experiences);
    expect(out.length).toBe(8);
    expect(out[0].inferredExperience).toBe('데이터베이스 구현');
    expect(out.some((q) => q.keywordName === '없음')).toBe(false);
  });

  it('runQuestions는 pending 삭제 후 재생성, 답한 질문 유지', async () => {
    const store = new MemoryStore();
    const sid = 's';
    await store.put({ PK: pk(sid), SK: SK.meta(), sessionId: sid });
    await store.put({ PK: pk(sid), SK: SK.kw('k1'), id: 'k1', name: '웹', experienceIds: ['e1'] });
    await store.put({ PK: pk(sid), SK: SK.exp('e1'), id: 'e1', keywordId: 'k1', text: '로그인 구현', origin: 'record', recordIds: ['r1'] });
    // 기존: pending 1 + 답한 것 1
    await store.put({ PK: pk(sid), SK: SK.q('qOldPending'), id: 'qOldPending', keywordId: 'k1', text: 'old', inferredExperience: 'x', status: 'pending' });
    await store.put({ PK: pk(sid), SK: SK.q('qAnswered'), id: 'qAnswered', keywordId: 'k1', text: 'ans', inferredExperience: 'y', status: 'yes' });

    await runQuestions({
      store, sessionId: sid, modelId: 'us.x', onEvent: async () => {},
      converseImpl: (async () => ({ questions: [{ keywordName: '웹', inferredExperience: '검색 기능', question: '검색도?' }] })) as any,
    });

    const qs = await getQuestions(store, sid);
    expect(qs.some((q) => q.id === 'qOldPending')).toBe(false); // pending 삭제됨
    expect(qs.some((q) => q.id === 'qAnswered')).toBe(true); // 답한 것 유지
    expect(qs.some((q) => q.inferredExperience === '검색 기능')).toBe(true); // 새로 생성
  });
});

describe('generate 검증', () => {
  it('englishWords 추출', () => {
    expect(englishWords('React와 Node.js로 구현').sort()).toEqual(['Node.js', 'React'].sort());
  });

  it('없는 id 항목 삭제 + 입력에 없는 기술명 bullet 삭제', () => {
    const content: PortfolioContent = {
      headline: 'h',
      intro: ['i'],
      skills: [
        { keywordId: 'k1', summary: 's1' },
        { keywordId: 'ghost', summary: 's2' }, // 존재하지 않음 → 삭제
      ],
      activities: [
        {
          recordId: 'r1',
          title: 't',
          period: 'p',
          bullets: [
            'React 로 화면 구현', // React 입력에 있음 → 유지
            'Rust 로 성능 최적화', // Rust 입력에 없음 → 삭제
            '문서를 정리', // 영문 없음 → 유지
          ],
        },
        { recordId: 'ghost', title: 't2', period: 'p', bullets: ['x'] }, // 존재하지 않음 → 삭제
      ],
    };
    const out = validateContent(
      content,
      [{ id: 'k1' }],
      [{ id: 'r1', title: 'proj', body: 'React 프로젝트' }],
    );
    expect(out.skills).toHaveLength(1);
    expect(out.activities).toHaveLength(1);
    expect(out.activities[0].bullets).toEqual(['React 로 화면 구현', '문서를 정리']);
  });

  it('periodOf 포맷', () => {
    expect(periodOf({ timeStart: '2024-01-01T00:00:00Z', timeEnd: '2024-03-01T00:00:00Z' } as RecordItem)).toBe('2024-01-01 ~ 2024-03-01');
    expect(periodOf({ timeStart: '2024-01-01T00:00:00Z' } as RecordItem)).toBe('2024-01-01');
    expect(periodOf({} as RecordItem)).toBe('기간 미상');
  });

  it('runGenerate: yes→answer 변환, 같은 S3 키로 두 번 업로드', async () => {
    const store = new MemoryStore();
    const sid = 'sess-abc';
    await store.put({ PK: pk(sid), SK: SK.meta(), sessionId: sid });
    await seedRecord(store, sid, { id: 'r1', body: 'Spring 으로 API 구현' });
    await store.put({ PK: pk(sid), SK: SK.kw('k1'), id: 'k1', name: '백엔드', experienceIds: ['e1'] });
    await store.put({ PK: pk(sid), SK: SK.exp('e1'), id: 'e1', keywordId: 'k1', text: 'API 구현', origin: 'record', recordIds: ['r1'], quote: 'Spring 으로 API 구현' });
    await store.put({ PK: pk(sid), SK: SK.q('q1'), id: 'q1', keywordId: 'k1', text: '캐시?', inferredExperience: '캐시 도입', status: 'yes' });

    const uploads: { sid: string; key: string }[] = [];
    const uploadHtml = vi.fn(async (s: string, _html: string) => {
      const key = `sites/${s}/index.html`;
      uploads.push({ sid: s, key });
      return key;
    });
    const converseImpl = (async (args: any) => {
      if (args.tool.name === 'write_portfolio') {
        return {
          headline: '백엔드 개발자',
          intro: ['API 를 설계하고 구현합니다.'],
          skills: [{ keywordId: 'k1', summary: '백엔드 역량' }],
          activities: [{ recordId: 'r1', title: 'API 프로젝트', period: '2024', bullets: ['Spring 으로 구현'] }],
        };
      }
      // refine (detail 없으므로 호출 안 됨) 대비
      return { text: '캐시 도입' };
    }) as any;

    const deps = {
      store, sessionId: sid, modelId: 'us.x', bucket: 'b', apiPublicBase: 'https://api.example.com',
      onEvent: async () => {}, uploadHtml, converseImpl,
    };
    await runGenerate(deps);
    await runGenerate(deps); // 재생성

    // yes 질문이 answer 경험으로 변환(한 번만)
    const exps = await getExperiences(store, sid);
    const answerExps = exps.filter((e) => e.origin === 'answer' && e.questionId === 'q1');
    expect(answerExps).toHaveLength(1);

    // 같은 S3 키
    expect(uploads.every((u) => u.key === `sites/${sid}/index.html`)).toBe(true);
    expect(uploads).toHaveLength(2);

    // SiteInfo 저장 + url (SITE_PUBLIC_BASE 없으면 API_PUBLIC_BASE/sites/{id})
    const site = await store.get(pk(sid), SK.site());
    expect(site?.url).toBe(`https://api.example.com/sites/${sid}`);
  });
});

describe('siteTemplate escape', () => {
  it('본문에 <script>가 있어도 실행 가능한 형태로 들어가지 않는다', () => {
    const content: PortfolioContent = {
      headline: '<script>alert(1)</script>',
      intro: ['<img src=x onerror=alert(1)>'],
      skills: [{ keywordId: 'k1', summary: '<b>요약</b>' }],
      activities: [{ recordId: 'r1', title: 't', period: 'p', bullets: ['<script>evil()</script>'] }],
    };
    const html = renderSite({
      content,
      keywords: [{ id: 'k1', name: '<i>키워드</i>', experienceIds: ['e1'] }],
      experiences: [{ id: 'e1', keywordId: 'k1', text: '<u>경험</u>', origin: 'answer', recordIds: [], questionId: 'q1' }],
      records: [{ id: 'r1', sessionId: 's', source: 'github', title: 't', url: 'https://x/r1', body: '', excluded: false, meta: {} }],
    });
    // 사용자 데이터 유래 <script> 는 이스케이프됨
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // answer 경험 배지 표시
    expect(html).toContain('본인 확인');
  });
});
