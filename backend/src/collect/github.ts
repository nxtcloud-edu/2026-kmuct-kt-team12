// backend/src/collect/github.ts
// 깃허브 REST API 로 README, 저장소 정보, 언어, 첫/마지막 커밋 날짜를 읽어
// rawText 와 meta 를 만든다. AI 를 쓰지 않는다(1단계).

import type { HttpPort } from '../ports.js';
import type { Artifact } from '../../../shared/types.js';

export interface FetchResult {
    rawText: string;
    meta: Artifact['meta'];
}

/** github.com/{owner}/{repo} URL 에서 owner, repo 를 뽑는다. */
export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
    try {
        const u = new URL(url);
        if (!/(^|\.)github\.com$/.test(u.hostname)) return null;
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts.length < 2) return null;
        return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
    } catch {
        return null;
    }
}

function ghHeaders(token?: string): Record<string, string> {
    const h: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'kiroton-collector',
    };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
}

/** base64 로 온 README content 를 디코드한다. */
function decodeBase64(content: string): string {
    return Buffer.from(content.replace(/\n/g, ''), 'base64').toString('utf8');
}

export async function fetchGithub(
    url: string,
    http: HttpPort,
    token?: string,
): Promise<FetchResult> {
    const parsed = parseGithubUrl(url);
    if (!parsed) throw new Error(`깃허브 URL 이 아니다: ${url}`);
    const { owner, repo } = parsed;
    const api = `https://api.github.com/repos/${owner}/${repo}`;
    const headers = ghHeaders(token);

    // 저장소 정보
    const repoRes = await http.get(api, headers);
    if (repoRes.status >= 400) {
        throw new Error(`깃허브 저장소 조회 실패(${repoRes.status}): ${owner}/${repo}`);
    }
    const repoInfo = JSON.parse(repoRes.body) as {
        description?: string;
        full_name?: string;
    };

    // README (없으면 빈 문자열)
    let readme = '';
    const readmeRes = await http.get(`${api}/readme`, headers);
    if (readmeRes.status < 400) {
        const r = JSON.parse(readmeRes.body) as { content?: string; encoding?: string };
        if (r.content && (r.encoding ?? 'base64') === 'base64') readme = decodeBase64(r.content);
        else if (r.content) readme = r.content;
    }

    // 언어
    let languages: string[] = [];
    const langRes = await http.get(`${api}/languages`, headers);
    if (langRes.status < 400) {
        languages = Object.keys(JSON.parse(langRes.body) as Record<string, number>);
    }

    // 커밋 범위: 최신 1개 + 가장 오래된 1개
    let commitRange: { first: string; last: string } | undefined;
    const lastRes = await http.get(`${api}/commits?per_page=1`, headers);
    if (lastRes.status < 400) {
        const commits = JSON.parse(lastRes.body) as Array<{ commit: { author: { date: string } } }>;
        const lastDate = commits[0]?.commit?.author?.date;
        // 마지막 페이지(가장 오래된 커밋)는 Link 헤더의 last 를 따라간다
        const link = lastRes.headers['link'] ?? lastRes.headers['Link'] ?? '';
        const lastPageMatch = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
        let firstDate = lastDate;
        if (lastPageMatch) {
            const firstRes = await http.get(`${api}/commits?per_page=1&page=${lastPageMatch[1]}`, headers);
            if (firstRes.status < 400) {
                const oldest = JSON.parse(firstRes.body) as Array<{ commit: { author: { date: string } } }>;
                firstDate = oldest[0]?.commit?.author?.date ?? lastDate;
            }
        }
        if (firstDate && lastDate) commitRange = { first: firstDate, last: lastDate };
    }

    const title = repoInfo.full_name ?? `${owner}/${repo}`;
    const rawText = [
        `# ${title}`,
        repoInfo.description ?? '',
        languages.length ? `언어: ${languages.join(', ')}` : '',
        '',
        readme,
    ]
        .filter((s) => s !== '')
        .join('\n');

    return {
        rawText,
        meta: {
            title,
            ...(commitRange ? { commitRange } : {}),
            ...(languages.length ? { languages } : {}),
        },
    };
}
