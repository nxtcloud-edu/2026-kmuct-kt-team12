// backend/src/collector/notion.ts
// 1단계 notion 수집. 토큰 필요. /v1/search(page) → /v1/blocks/{id}/children 재귀(깊이3).
// 공개 페이지 HTML 을 긁지 않는다.

import { safeFetch, type SafeFetchOptions } from '../lib/safeFetch.js';
import type { RawRecord } from './normalize.js';

const API = 'https://api.notion.com';
const NOTION_VERSION = '2022-06-28';
const MAX_DEPTH = 3;

interface NotionOptions {
  token: string;
  maxPages: number;
  fetchOpts?: SafeFetchOptions;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

interface RichText {
  plain_text?: string;
}
interface NotionPage {
  id: string;
  url?: string;
  created_time?: string;
  last_edited_time?: string;
  properties?: Record<string, { type?: string; title?: RichText[] }>;
}
interface SearchResponse {
  results: NotionPage[];
}
interface Block {
  id: string;
  type: string;
  has_children?: boolean;
  [k: string]: unknown;
}
interface BlockChildrenResponse {
  results: Block[];
}

export function pageTitle(page: NotionPage): string {
  const props = page.properties ?? {};
  for (const val of Object.values(props)) {
    if (val.type === 'title' && Array.isArray(val.title)) {
      const t = val.title.map((r) => r.plain_text ?? '').join('').trim();
      if (t) return t;
    }
  }
  return '(제목 없음)';
}

// 블록 하나에서 rich_text 계열 텍스트 추출
export function blockText(block: Block): string {
  const payload = block[block.type] as { rich_text?: RichText[] } | undefined;
  if (payload?.rich_text) {
    return payload.rich_text.map((r) => r.plain_text ?? '').join('');
  }
  return '';
}

async function fetchChildren(
  blockId: string,
  token: string,
  fetchOpts: SafeFetchOptions | undefined,
  depth: number,
): Promise<string> {
  if (depth > MAX_DEPTH) return '';
  const r = await safeFetch(`${API}/v1/blocks/${blockId}/children?page_size=100`, {
    ...fetchOpts,
    headers: headers(token),
  });
  if (r.status !== 200) return '';
  const data = JSON.parse(r.text) as BlockChildrenResponse;
  const parts: string[] = [];
  for (const block of data.results) {
    const t = blockText(block);
    if (t) parts.push(t);
    if (block.has_children && depth < MAX_DEPTH) {
      const child = await fetchChildren(block.id, token, fetchOpts, depth + 1);
      if (child) parts.push(child);
    }
  }
  return parts.join('\n');
}

export async function collectNotion(opts: NotionOptions): Promise<RawRecord[]> {
  const { token, maxPages, fetchOpts } = opts;
  const searchRes = await safeFetch(`${API}/v1/search`, {
    ...fetchOpts,
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ filter: { property: 'object', value: 'page' }, page_size: maxPages }),
  });
  if (searchRes.status !== 200) throw new Error(`notion search 응답 ${searchRes.status}`);
  const search = JSON.parse(searchRes.text) as SearchResponse;

  const out: RawRecord[] = [];
  for (const page of search.results.slice(0, maxPages)) {
    try {
      const body = await fetchChildren(page.id, token, fetchOpts, 1);
      out.push({
        source: 'notion',
        url: page.url ?? `https://www.notion.so/${page.id.replace(/-/g, '')}`,
        title: pageTitle(page),
        timeStart: page.created_time,
        timeEnd: page.last_edited_time,
        body,
        meta: {},
      });
    } catch (e) {
      console.error(`notion page 실패: ${page.id} (${(e as Error).message.length}자)`);
    }
  }
  return out;
}
