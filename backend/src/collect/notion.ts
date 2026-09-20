// backend/src/collect/notion.ts
// 노션: 공식 API + 통합 토큰으로 페이지 본문을 읽는다.
// 공개 페이지 HTML 은 자바스크립트로 그려져 단순 요청으로 본문이 비므로 API 를 쓴다.

import type { HttpPort } from '../ports.js';
import type { FetchResult } from './github.js';

const NOTION_VERSION = '2022-06-28';

/** notion.so URL 에서 32자리 페이지 id 를 뽑아 하이픈 형식으로 만든다.
 * id 는 URL 끝(마지막 세그먼트의 꼬리)에 붙으므로, 슬러그 글자에 hex 문자가 섞여도
 * "끝에서 32 hex" 를 기준으로 잡는다. */
export function parseNotionPageId(url: string): string | null {
    try {
        const u = new URL(url);
        if (!/notion\.(so|site)$/.test(u.hostname)) return null;
        const lastSeg = u.pathname.split('/').filter(Boolean).pop() ?? '';
        const compact = lastSeg.replace(/-/g, '');
        const m = compact.match(/([0-9a-f]{32})$/i);
        if (!m) return null;
        const h = m[1].toLowerCase();
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    } catch {
        return null;
    }
}

interface RichText {
    plain_text?: string;
}
interface Block {
    type: string;
    [k: string]: unknown;
}

/** 블록 하나에서 rich_text plain_text 를 이어붙인다. */
function blockText(block: Block): string {
    const body = block[block.type] as { rich_text?: RichText[] } | undefined;
    if (!body?.rich_text) return '';
    return body.rich_text.map((r) => r.plain_text ?? '').join('');
}

export async function fetchNotion(
    url: string,
    http: HttpPort,
    token?: string,
): Promise<FetchResult> {
    if (!token) throw new Error('노션 통합 토큰이 없다 (NOTION_TOKEN)');
    const pageId = parseNotionPageId(url);
    if (!pageId) throw new Error(`노션 URL 이 아니다: ${url}`);

    const headers = {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'User-Agent': 'kiroton-collector',
    };

    // 페이지 메타(제목)
    let title: string | undefined;
    const pageRes = await http.get(`https://api.notion.com/v1/pages/${pageId}`, headers);
    if (pageRes.status < 400) {
        const page = JSON.parse(pageRes.body) as {
            properties?: Record<string, { title?: RichText[] }>;
        };
        for (const prop of Object.values(page.properties ?? {})) {
            if (prop.title) {
                title = prop.title.map((r) => r.plain_text ?? '').join('');
                break;
            }
        }
    }

    // 블록(본문) — 페이지네이션 따라가기
    const lines: string[] = [];
    let cursor: string | undefined;
    do {
        const q = cursor ? `?start_cursor=${cursor}&page_size=100` : `?page_size=100`;
        const res = await http.get(`https://api.notion.com/v1/blocks/${pageId}/children${q}`, headers);
        if (res.status >= 400) throw new Error(`노션 블록 조회 실패(${res.status})`);
        const data = JSON.parse(res.body) as {
            results?: Block[];
            has_more?: boolean;
            next_cursor?: string | null;
        };
        for (const b of data.results ?? []) {
            const t = blockText(b);
            if (t) lines.push(t);
        }
        cursor = data.has_more ? data.next_cursor ?? undefined : undefined;
    } while (cursor);

    const rawText = [title ? `# ${title}` : '', ...lines].filter(Boolean).join('\n');
    return { rawText, meta: title ? { title } : {} };
}
