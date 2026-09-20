// backend/src/api/verify.ts
// 연결 검증: 각 출처를 1회 가벼운 호출로 확인 (10초 이내).
// github GET /user, notion GET /v1/users/me, tistory RSS 요청.

import { safeFetch, type SafeFetchOptions } from '../lib/safeFetch.js';
import type { Connections } from '../types.js';

export type VerifyStatus = 'ok' | 'fail';
export interface VerifyResult {
  github?: VerifyStatus;
  notion?: VerifyStatus;
  tistory?: VerifyStatus;
}

const NOTION_VERSION = '2022-06-28';

export async function verifyConnections(
  conn: Connections,
  fetchOpts: SafeFetchOptions = {},
): Promise<VerifyResult> {
  const out: VerifyResult = {};
  const jobs: Promise<void>[] = [];

  if (conn.githubToken) {
    jobs.push(
      (async () => {
        try {
          const r = await safeFetch('https://api.github.com/user', {
            ...fetchOpts,
            headers: {
              Authorization: `Bearer ${conn.githubToken}`,
              Accept: 'application/vnd.github+json',
            },
          });
          out.github = r.status === 200 ? 'ok' : 'fail';
        } catch {
          out.github = 'fail';
        }
      })(),
    );
  }

  if (conn.notionToken) {
    jobs.push(
      (async () => {
        try {
          const r = await safeFetch('https://api.notion.com/v1/users/me', {
            ...fetchOpts,
            headers: {
              Authorization: `Bearer ${conn.notionToken}`,
              'Notion-Version': NOTION_VERSION,
            },
          });
          out.notion = r.status === 200 ? 'ok' : 'fail';
        } catch {
          out.notion = 'fail';
        }
      })(),
    );
  }

  if (conn.tistoryUrl) {
    jobs.push(
      (async () => {
        try {
          const base = normalizeTistoryUrl(conn.tistoryUrl!);
          const r = await safeFetch(`${base}/rss`, fetchOpts);
          out.tistory = r.status === 200 && r.text.includes('<rss') ? 'ok' : 'fail';
        } catch {
          out.tistory = 'fail';
        }
      })(),
    );
  }

  await Promise.all(jobs);
  return out;
}

export function normalizeTistoryUrl(raw: string): string {
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  // 끝의 슬래시 제거
  return u.replace(/\/+$/, '');
}
