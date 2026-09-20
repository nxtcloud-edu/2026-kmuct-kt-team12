import { describe, it, expect, vi } from 'vitest';
import { collectGithub, lastPageFromLink } from './github.js';
import { collectNotion, blockText, pageTitle } from './notion.js';
import { collectTistory, parseRssItems, pubDateToIso } from './tistory.js';
import { runCollect } from './collect.js';
import { toRecordItem, cleanText, recordId, stripHtml } from './normalize.js';
import { MemoryStore, pk, SK, getRecords } from '../lib/db.js';
import type { SafeFetchOptions, SafeResponse } from '../lib/safeFetch.js';
import * as ghFix from '../../fixtures/github.js';
import * as ntFix from '../../fixtures/notion.js';
import * as tsFix from '../../fixtures/tistory.js';

// URL 라우팅 기반 fake fetch
function fakeFetch(routes: Array<{ match: RegExp; res: Partial<SafeResponse> & { status: number; text: string; headers?: Headers } }>) {
  return vi.fn(async (url: string) => {
    for (const r of routes) {
      if (r.match.test(url)) {
        return {
          status: r.res.status,
          headers: r.res.headers ?? new Headers(),
          arrayBuffer: async () => new TextEncoder().encode(r.res.text).buffer,
        };
      }
    }
    throw new Error(`unrouted: ${url}`);
  }) as unknown as typeof fetch;
}
function opts(fetchImpl: typeof fetch): SafeFetchOptions {
  return { fetchImpl };
}

describe('normalize', () => {
  it('stripHtml + 공백정리 + 40000자 컷', () => {
    const out = cleanText('<p>hello   <b>world</b></p>\n\n\n\nx');
    expect(out).toBe('hello world\n\nx');
    expect(cleanText('a'.repeat(50000)).length).toBe(40000);
  });
  it('recordId는 url 기준 결정론적', () => {
    expect(recordId('github', 'u')).toBe(recordId('github', 'u'));
    expect(recordId('github', 'u')).not.toBe(recordId('github', 'v'));
  });
  it('본문 200자 미만이면 자동 제외', () => {
    const item = toRecordItem('s', { source: 'github', url: 'u', title: 't', body: '짧다', meta: {} });
    expect(item.excluded).toBe(true);
    expect(item.excludedReason).toBe('본문이 너무 짧음');
  });
});

describe('github', () => {
  it('lastPageFromLink 파싱', () => {
    const link = '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=5>; rel="last"';
    expect(lastPageFromLink(link)).toBe(5);
    expect(lastPageFromLink(null)).toBeUndefined();
  });

  it('fork/커밋부족 자동제외, 정상 저장소는 포함', async () => {
    const fetchImpl = fakeFetch([
      { match: /\/user$/, res: { status: 200, text: JSON.stringify(ghFix.ghUser) } },
      { match: /\/user\/repos/, res: { status: 200, text: JSON.stringify(ghFix.ghRepos) } },
      { match: /portfolio-site\/readme/, res: { status: 200, text: ghFix.ghReadmeLong } },
      { match: /forked-lib\/readme/, res: { status: 200, text: '짧은 리드미' } },
      { match: /tiny\/readme/, res: { status: 200, text: '작음' } },
      { match: /\/languages/, res: { status: 200, text: JSON.stringify(ghFix.ghLanguages) } },
      { match: /portfolio-site\/commits/, res: { status: 200, text: JSON.stringify(ghFix.ghCommitsMany) } },
      { match: /forked-lib\/commits/, res: { status: 200, text: JSON.stringify(ghFix.ghCommitsMany) } },
      { match: /tiny\/commits/, res: { status: 200, text: JSON.stringify(ghFix.ghCommitsFew) } },
    ]);
    const raws = await collectGithub({ token: 't', maxRepos: 20, fetchOpts: opts(fetchImpl) });
    const items = raws.map((r) => toRecordItem('s', r));
    const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));

    expect(byTitle['portfolio-site'].excluded).toBe(false);
    expect(byTitle['forked-lib'].excluded).toBe(true);
    expect(byTitle['forked-lib'].excludedReason).toBe('fork 저장소');
    expect(byTitle['tiny'].excluded).toBe(true);
    expect(byTitle['tiny'].excludedReason).toBe('내 커밋 3개 미만');
    // 언어/커밋 메타
    expect(byTitle['portfolio-site'].meta.languages).toContain('TypeScript');
  });
});

describe('notion', () => {
  it('blockText / pageTitle 추출', () => {
    expect(pageTitle(ntFix.notionSearch.results[0] as any)).toBe('데이터 분석 프로젝트 회고');
    expect(blockText(ntFix.notionBlocksRoot.results[0] as any)).toContain('판다스');
  });

  it('search → blocks 재귀로 본문 구성', async () => {
    const fetchImpl = fakeFetch([
      { match: /\/v1\/search/, res: { status: 200, text: JSON.stringify(ntFix.notionSearch) } },
      { match: /blocks\/page-1\/children/, res: { status: 200, text: JSON.stringify(ntFix.notionBlocksRoot) } },
      { match: /blocks\/b2\/children/, res: { status: 200, text: JSON.stringify(ntFix.notionBlocksChild) } },
    ]);
    const raws = await collectNotion({ token: 't', maxPages: 20, fetchOpts: opts(fetchImpl) });
    expect(raws).toHaveLength(1);
    expect(raws[0].title).toBe('데이터 분석 프로젝트 회고');
    expect(raws[0].body).toContain('판다스');
    expect(raws[0].body).toContain('시각화 대시보드'); // 깊이2 자식
    expect(raws[0].timeStart).toBe('2024-02-01T00:00:00.000Z');
  });
});

describe('tistory', () => {
  it('RSS 파싱과 pubDate 변환', () => {
    const items = parseRssItems(tsFix.tistoryRss);
    expect(items).toHaveLength(2);
    expect(pubDateToIso(items[0].pubDate)).toBeTruthy();
    expect(pubDateToIso('없는날짜')).toBeUndefined();
  });

  it('description이 짧으면 링크 본문(Readability) 사용, 길면 그대로', async () => {
    const fetchImpl = fakeFetch([
      { match: /\/rss$/, res: { status: 200, text: tsFix.tistoryRss } },
      { match: /tistory\.com\/10$/, res: { status: 200, text: tsFix.tistoryPostHtml } },
    ]);
    const raws = await collectTistory({ url: 'myblog.tistory.com', maxPosts: 20, fetchOpts: opts(fetchImpl) });
    expect(raws).toHaveLength(2);
    const post10 = raws.find((r) => r.url.endsWith('/10'))!;
    // Readability 추출 본문에 원문 문구 포함
    expect(stripHtml(post10.body)).toContain('REST API');
    const post11 = raws.find((r) => r.url.endsWith('/11'))!;
    expect(post11.body.length).toBeGreaterThan(300);
  }, 20000);
});

describe('runCollect 오케스트레이션', () => {
  const limits = { maxRepos: 20, maxPosts: 20, maxPages: 20 };

  it('출처 하나 실패해도 나머지로 계속', async () => {
    const store = new MemoryStore();
    await store.put({ PK: pk('s'), SK: SK.meta(), sessionId: 's' });
    const events: string[] = [];
    const { count } = await runCollect({
      store,
      sessionId: 's',
      connections: { githubToken: 'g', tistoryUrl: 'b.tistory.com' },
      limits,
      onEvent: async (m) => {
        events.push(m);
      },
      sources: {
        github: async () => {
          throw new Error('github 다운');
        },
        tistory: async () => [
          { source: 'tistory', url: 'https://b.tistory.com/1', title: '글', body: 'x'.repeat(300), meta: {} },
        ],
      },
    });
    expect(count).toBe(1);
    expect(events.some((e) => e.includes('깃허브 연결에 실패'))).toBe(true);
    expect(events.some((e) => e.includes('티스토리 글 1개'))).toBe(true);
  });

  it('기록 0개면 예외', async () => {
    const store = new MemoryStore();
    await store.put({ PK: pk('s'), SK: SK.meta(), sessionId: 's' });
    await expect(
      runCollect({
        store,
        sessionId: 's',
        connections: { githubToken: 'g' },
        limits,
        onEvent: async () => {},
        sources: { github: async () => [] },
      }),
    ).rejects.toThrow('수집된 기록이 없습니다');
  });

  it('재수집 시 사용자가 바꾼 excluded 유지', async () => {
    const store = new MemoryStore();
    await store.put({ PK: pk('s'), SK: SK.meta(), sessionId: 's' });
    const raw = { source: 'github' as const, url: 'https://github.com/o/r', title: 'r', body: 'y'.repeat(300), meta: {} };

    // 1차 수집: excluded=false
    await runCollect({
      store, sessionId: 's', connections: { githubToken: 'g' }, limits,
      onEvent: async () => {}, sources: { github: async () => [raw] },
    });
    let recs = await getRecords(store, 's');
    expect(recs[0].excluded).toBe(false);

    // 사용자가 수동 제외
    recs[0].excluded = true;
    await store.put({ PK: pk('s'), SK: SK.rec(recs[0].id), ...recs[0] });

    // 2차 수집(같은 url): 사용자 excluded=true 유지
    await runCollect({
      store, sessionId: 's', connections: { githubToken: 'g' }, limits,
      onEvent: async () => {}, sources: { github: async () => [{ ...raw, body: 'z'.repeat(400) }] },
    });
    recs = await getRecords(store, 's');
    expect(recs).toHaveLength(1);
    expect(recs[0].excluded).toBe(true);
    expect(recs[0].body).toContain('z'); // 내용은 갱신됨
  });
});
