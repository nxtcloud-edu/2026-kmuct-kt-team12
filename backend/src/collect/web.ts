// backend/src/collect/web.ts
// 블로그/웹: 페이지를 요청해 본문을 추출한다. 사이트별 파서를 만들지 않는다.
// 실제 본문 추출(Readability)은 HtmlExtractor 포트 뒤에 둔다. 기본 구현은 태그 제거 방식이고,
// 나중에 @mozilla/readability 구현체로 교체할 수 있다(의존성 추가는 그때 확인).

import type { HttpPort } from '../ports.js';
import type { Artifact } from '../../../shared/types.js';
import type { FetchResult } from './github.js';

export interface HtmlExtractor {
    extract(html: string, url: string): { title?: string; text: string; publishedAt?: string };
}

/** <script>/<style> 제거 후 태그를 벗기고 공백을 정리하는 최소 추출기. */
export const basicHtmlExtractor: HtmlExtractor = {
    extract(html: string): { title?: string; text: string; publishedAt?: string } {
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : undefined;

        // 작성일 추정: <meta property="article:published_time"> 등
        const pub = html.match(
            /<meta[^>]+(?:property|name)=["'](?:article:published_time|datePublished)["'][^>]*content=["']([^"']+)["']/i,
        );
        const publishedAt = pub ? pub[1] : undefined;

        let body = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<!--[\s\S]*?-->/g, ' ');
        // 블록 태그는 줄바꿈으로
        body = body.replace(/<\/(p|div|section|article|li|h[1-6]|br)>/gi, '\n');
        body = body.replace(/<[^>]+>/g, ' ');
        body = decodeEntities(body);
        body = body
            .split('\n')
            .map((l) => l.replace(/[ \t]+/g, ' ').trim())
            .filter((l) => l.length > 0)
            .join('\n');

        return { title, text: body, publishedAt };
    },
};

function decodeEntities(s: string): string {
    return s
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

export async function fetchWeb(
    url: string,
    http: HttpPort,
    extractor: HtmlExtractor = basicHtmlExtractor,
): Promise<FetchResult> {
    const res = await http.get(url, { 'User-Agent': 'kiroton-collector' });
    if (res.status >= 400) throw new Error(`웹 페이지 조회 실패(${res.status}): ${url}`);
    const { title, text, publishedAt } = extractor.extract(res.body, url);

    const meta: Artifact['meta'] = {};
    if (title) meta.title = title;
    if (publishedAt) meta.publishedAt = publishedAt;

    return { rawText: text, meta };
}
