// backend/src/collect/tistory.ts
// 티스토리: Open API v1 로 블로그 글을 읽는다. Personal Access Token 방식.
// URL 에서 블로그명과 글 번호를 뽑아 API 로 제목·날짜·본문을 가져온다.

import type { HttpPort } from '../ports.js';
import type { FetchResult } from './github.js';

const API_BASE = 'https://www.tistory.com/apis';

/** {blogName}.tistory.com/{postId?} 형태에서 블로그명과 글 번호를 뽑는다. */
export function parseTistoryUrl(url: string): { blogName: string; postId?: string } | null {
    try {
        const u = new URL(url);
        if (!u.hostname.endsWith('tistory.com')) return null;
        const blogName = u.hostname.split('.')[0];
        if (!blogName || blogName === 'www' || blogName === 'tistory') return null;
        const parts = u.pathname.split('/').filter(Boolean);
        // /123 또는 /entry/slug 형태
        const postId = parts.length >= 1 && /^\d+$/.test(parts[0]) ? parts[0] : undefined;
        return { blogName, postId };
    } catch {
        return null;
    }
}

/** HTML 태그를 벗기고 공백을 정리한다. */
function stripHtml(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<\/(p|div|section|article|li|h[1-6]|br)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .split('\n')
        .map((l) => l.replace(/[ \t]+/g, ' ').trim())
        .filter((l) => l.length > 0)
        .join('\n');
}

interface TistoryPost {
    title: string;
    content: string;
    date: string;        // "2024-03-15 10:30:00"
    tags?: string[];
}

/** 특정 글 하나를 API 로 읽는다. */
async function fetchPost(
    blogName: string,
    postId: string,
    http: HttpPort,
    token: string,
): Promise<TistoryPost> {
    const url = `${API_BASE}/post/read?access_token=${token}&output=json&blogName=${blogName}&postId=${postId}`;
    const res = await http.get(url);
    if (res.status >= 400) throw new Error(`티스토리 글 조회 실패(${res.status}): ${blogName}/${postId}`);
    const data = JSON.parse(res.body) as {
        tistory?: {
            status?: string;
            item?: {
                title?: string;
                content?: string;
                date?: string;
                tags?: { tag?: string[] };
            };
        };
    };
    const item = data.tistory?.item;
    if (!item) throw new Error('티스토리 API 응답에 item 이 없다');
    return {
        title: item.title ?? '',
        content: item.content ?? '',
        date: item.date ?? '',
        tags: item.tags?.tag ?? [],
    };
}

/** 블로그의 최근 글 목록을 가져온다(최대 10개). */
async function fetchRecentPostIds(
    blogName: string,
    http: HttpPort,
    token: string,
): Promise<string[]> {
    const url = `${API_BASE}/post/list?access_token=${token}&output=json&blogName=${blogName}&page=1&count=10`;
    const res = await http.get(url);
    if (res.status >= 400) throw new Error(`티스토리 글 목록 조회 실패(${res.status}): ${blogName}`);
    const data = JSON.parse(res.body) as {
        tistory?: {
            item?: {
                posts?: Array<{ id?: string }>;
            };
        };
    };
    return (data.tistory?.item?.posts ?? []).map((p) => p.id ?? '').filter(Boolean);
}

export async function fetchTistory(
    url: string,
    http: HttpPort,
    token?: string,
): Promise<FetchResult> {
    if (!token) throw new Error('티스토리 액세스 토큰이 없다 (TISTORY_TOKEN)');
    const parsed = parseTistoryUrl(url);
    if (!parsed) throw new Error(`티스토리 URL 이 아니다: ${url}`);
    const { blogName, postId } = parsed;

    if (postId) {
        // 특정 글 하나
        const post = await fetchPost(blogName, postId, http, token);
        const rawText = [`# ${post.title}`, '', stripHtml(post.content)].join('\n');
        return {
            rawText,
            meta: {
                title: post.title,
                ...(post.date ? { publishedAt: post.date } : {}),
            },
        };
    }

    // 블로그 전체: 최근 글들을 합친다
    const ids = await fetchRecentPostIds(blogName, http, token);
    if (ids.length === 0) throw new Error(`티스토리 블로그에 글이 없다: ${blogName}`);

    const posts: TistoryPost[] = [];
    for (const id of ids) {
        posts.push(await fetchPost(blogName, id, http, token));
    }

    const rawText = posts
        .map((p) => [`## ${p.title}`, `작성일: ${p.date}`, '', stripHtml(p.content)].join('\n'))
        .join('\n\n---\n\n');

    return {
        rawText,
        meta: { title: `${blogName} 블로그 (${posts.length}개 글)` },
    };
}
