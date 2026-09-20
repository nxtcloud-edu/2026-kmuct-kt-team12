// backend/src/collector/tistory.ts
// 1단계 tistory 수집. 토큰 없음(Open API 종료) → RSS 사용.
// {블로그주소}/rss 를 fast-xml-parser 로 파싱. 항목마다 title/pubDate/link/description.
// description<500자면 link 를 safeFetch → linkedom + Readability 로 본문 추출.
// 실패 시 description 태그 제거.

import { XMLParser } from 'fast-xml-parser';
import { safeFetch, type SafeFetchOptions } from '../lib/safeFetch.js';
import type { RawRecord } from './normalize.js';
import { stripHtml, cleanText } from './normalize.js';
import { normalizeTistoryUrl } from '../api/verify.js';

interface TistoryOptions {
  url: string;
  maxPosts: number;
  fetchOpts?: SafeFetchOptions;
}

interface RssItem {
  title?: string;
  link?: string;
  pubDate?: string;
  description?: string;
}

// parseTagValue:false → 숫자로 보이는 본문/제목이 number로 변환되는 것 방지(문자열 유지).
const parser = new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false });

// fast-xml-parser 결과가 문자열이 아닐 수 있어 안전하게 문자열화
function asText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return String(v);
}

export function parseRssItems(xml: string): RssItem[] {
  const doc = parser.parse(xml) as {
    rss?: { channel?: { item?: RssItem | RssItem[] } };
  };
  const item = doc.rss?.channel?.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

// pubDate(RFC822) → ISO. 실패하면 undefined.
export function pubDateToIso(pubDate?: string): string | undefined {
  if (!pubDate) return undefined;
  const t = Date.parse(pubDate);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

// linkedom + Readability 로 본문 추출. 실패 시 undefined.
async function extractReadable(html: string, url: string): Promise<string | undefined> {
  try {
    const { parseHTML } = await import('linkedom');
    const { Readability } = await import('@mozilla/readability');
    const { document } = parseHTML(html);
    // Readability 는 baseURI 를 참조하므로 대응이 어려우면 그대로 진행
    const article = new Readability(document as unknown as Document).parse();
    const text = article?.textContent?.trim();
    return text && text.length > 0 ? text : undefined;
  } catch (e) {
    console.error(`readability 실패: ${url} (${(e as Error).message.length}자)`);
    return undefined;
  }
}

export async function collectTistory(opts: TistoryOptions): Promise<RawRecord[]> {
  const base = normalizeTistoryUrl(opts.url);
  const rss = await safeFetch(`${base}/rss`, opts.fetchOpts);
  if (rss.status !== 200) throw new Error(`tistory rss 응답 ${rss.status}`);
  const items = parseRssItems(rss.text).slice(0, opts.maxPosts);

  const out: RawRecord[] = [];
  for (const item of items) {
    const link = asText(item.link);
    const desc = asText(item.description);
    const title = asText(item.title);
    let body: string;

    if (stripHtml(desc).length >= 500) {
      body = desc;
    } else if (link) {
      let readable: string | undefined;
      try {
        const page = await safeFetch(link, opts.fetchOpts);
        if (page.status === 200) readable = await extractReadable(page.text, link);
      } catch {
        readable = undefined;
      }
      body = readable ?? desc;
    } else {
      body = desc;
    }

    out.push({
      source: 'tistory',
      url: link || `${base}#${cleanText(title).slice(0, 20)}`,
      title: title || '(제목 없음)',
      timeStart: pubDateToIso(asText(item.pubDate)),
      body,
      meta: {},
    });
  }
  return out;
}
