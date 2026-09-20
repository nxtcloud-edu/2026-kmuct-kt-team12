// backend/src/collector/github.ts
// 1단계 github 수집. 토큰 필요. 모든 요청은 safeFetch 경유.
// 자동 제외: fork 저장소, 내 커밋 3개 미만, body 200자 미만(normalize에서).

import { safeFetch, type SafeFetchOptions } from '../lib/safeFetch.js';
import type { RawRecord } from './normalize.js';

const API = 'https://api.github.com';

interface GhOptions {
  token: string;
  maxRepos: number;
  fetchOpts?: SafeFetchOptions;
}

function authHeaders(token: string, accept = 'application/vnd.github+json'): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function ghJson<T>(url: string, token: string, opts?: SafeFetchOptions): Promise<T> {
  const r = await safeFetch(url, { ...opts, headers: authHeaders(token) });
  if (r.status !== 200) throw new Error(`github ${url} 응답 ${r.status}`);
  return JSON.parse(r.text) as T;
}

interface GhUser {
  login: string;
}
interface GhRepo {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  fork: boolean;
  owner: { login: string };
}
interface GhCommit {
  commit: { message: string; author?: { date?: string } };
}

// Link 헤더에서 rel="last" 페이지 번호 추출
export function lastPageFromLink(link: string | null): number | undefined {
  if (!link) return undefined;
  const m = link.match(/[?&]page=(\d+)[^>]*>\s*;\s*rel="last"/);
  return m ? Number(m[1]) : undefined;
}

export async function collectGithub(opts: GhOptions): Promise<RawRecord[]> {
  const { token, maxRepos, fetchOpts } = opts;
  const user = await ghJson<GhUser>(`${API}/user`, token, fetchOpts);
  const login = user.login;

  const repos = await ghJson<GhRepo[]>(
    `${API}/user/repos?affiliation=owner&sort=pushed&per_page=${maxRepos}`,
    token,
    fetchOpts,
  );

  const out: RawRecord[] = [];
  for (const repo of repos) {
    try {
      out.push(await collectRepo(repo, login, token, fetchOpts));
    } catch (e) {
      // 저장소 하나 실패는 건너뛴다 (전체 수집은 계속)
      console.error(`github repo 실패: ${repo.full_name} (${(e as Error).message.length}자)`);
    }
  }
  return out;
}

async function collectRepo(
  repo: GhRepo,
  login: string,
  token: string,
  fetchOpts?: SafeFetchOptions,
): Promise<RawRecord> {
  // README (raw). 없으면 빈 문자열.
  let readme = '';
  try {
    const r = await safeFetch(`${API}/repos/${repo.full_name}/readme`, {
      ...fetchOpts,
      headers: authHeaders(token, 'application/vnd.github.raw'),
    });
    if (r.status === 200) readme = r.text;
  } catch {
    readme = '';
  }

  // languages
  let languages: string[] = [];
  try {
    const langs = await ghJson<Record<string, number>>(
      `${API}/repos/${repo.full_name}/languages`,
      token,
      fetchOpts,
    );
    languages = Object.keys(langs);
  } catch {
    languages = [];
  }

  // 내 커밋 (per_page=30)
  const commitsUrl = `${API}/repos/${repo.full_name}/commits?author=${encodeURIComponent(login)}&per_page=30`;
  let commits: GhCommit[] = [];
  let firstCommitDate: string | undefined;
  let commitCount = 0;
  try {
    const r = await safeFetch(commitsUrl, { ...fetchOpts, headers: authHeaders(token) });
    if (r.status === 200) {
      commits = JSON.parse(r.text) as GhCommit[];
      // 마지막 페이지(가장 오래된 커밋)로 첫 커밋 날짜 + 총 개수 추정
      const lastPage = lastPageFromLink(r.headers.get('link'));
      if (lastPage && lastPage > 1) {
        commitCount = (lastPage - 1) * 30 + 1; // 대략치(하한). 정확 개수는 별도 API 필요.
        try {
          const lr = await safeFetch(`${commitsUrl}&page=${lastPage}`, {
            ...fetchOpts,
            headers: authHeaders(token),
          });
          if (lr.status === 200) {
            const lastCommits = JSON.parse(lr.text) as GhCommit[];
            const oldest = lastCommits[lastCommits.length - 1];
            firstCommitDate = oldest?.commit.author?.date;
            commitCount = (lastPage - 1) * 30 + lastCommits.length;
          }
        } catch {
          /* 무시 */
        }
      } else {
        commitCount = commits.length;
        firstCommitDate = commits[commits.length - 1]?.commit.author?.date;
      }
    }
  } catch {
    commits = [];
  }

  const lastCommitDate = commits[0]?.commit.author?.date;
  const messages = commits.map((c) => c.commit.message.split('\n')[0]).filter(Boolean);

  const body =
    (repo.description ?? '') +
    '\n\n' +
    readme +
    (messages.length ? '\n\n최근 커밋 메시지:\n' + messages.join('\n') : '');

  // 자동 제외 판단 (본문 길이 제외는 normalize에서)
  let autoExcludeReason: string | undefined;
  if (repo.fork) autoExcludeReason = 'fork 저장소';
  else if (commitCount < 3) autoExcludeReason = '내 커밋 3개 미만';

  return {
    source: 'github',
    url: repo.html_url,
    title: repo.name,
    timeStart: firstCommitDate,
    timeEnd: lastCommitDate,
    body,
    meta: { languages, commitCount, commitMessages: messages },
    autoExcludeReason,
  };
}
