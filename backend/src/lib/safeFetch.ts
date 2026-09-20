// backend/src/lib/safeFetch.ts
// 모든 외부 요청은 이 함수를 거친다.
// - http/https만 허용
// - 호스트가 localhost / 사설 IP(10.x, 172.16~31.x, 192.168.x) / 169.254.x.x / IPv6 루프백이면 거부
// - 리다이렉트 최대 3회, 매번 재검사
// - 타임아웃 10초, 본문 2MB 초과 시 중단
// - User-Agent 명시
//
// ponytail: 호스트명/IP 리터럴 기반 SSRF 차단. DNS 리바인딩(도메인이 사설 IP로 해석되는 경우)은
// 막지 못한다 — Node 내장 fetch에는 연결된 소켓 IP를 검사할 훅이 없고, 명세는 호스트 패턴 차단만 요구.
// 업그레이드 경로: undici Agent의 connect 훅으로 소켓 remoteAddress 검사.

const USER_AGENT = 'portfolio-generator/1.0 (+https://github.com/2026-kmuct-kt-team12)';
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export class SafeFetchError extends Error {}

function isBlockedHost(hostname: string): boolean {
  let h = hostname.toLowerCase();
  // IPv6 대괄호 제거
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);

  if (h === 'localhost' || h.endsWith('.localhost')) return true;

  // IPv6 루프백
  if (h === '::1' || h === '::' || h === '0:0:0:0:0:0:0:1') return true;
  // IPv4-mapped IPv6 루프백/사설도 방어적으로 처리
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isBlockedIpv4(mapped[1]);

  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return isBlockedIpv4(h);

  return false;
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    // 형식이 이상하면 안전하게 차단
    return true;
  }
  const [a, b] = parts;
  if (a === 127) return true; // 루프백
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (링크 로컬)
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

function assertSafeUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SafeFetchError(`잘못된 URL: ${raw}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SafeFetchError(`허용되지 않은 프로토콜: ${u.protocol}`);
  }
  if (isBlockedHost(u.hostname)) {
    throw new SafeFetchError(`차단된 호스트: ${u.hostname}`);
  }
  return u;
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  // 테스트 주입용. 미지정 시 전역 fetch.
  fetchImpl?: typeof fetch;
}

export interface SafeResponse {
  status: number;
  headers: Headers;
  text: string;
  url: string;
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const doFetch = opts.fetchImpl ?? fetch;
  let currentUrl = assertSafeUrl(rawUrl).toString();

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await doFetch(currentUrl, {
        method: opts.method ?? 'GET',
        headers: { 'User-Agent': USER_AGENT, ...(opts.headers ?? {}) },
        body: opts.body,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof SafeFetchError) throw e;
      throw new SafeFetchError(`요청 실패: ${(e as Error).message}`);
    }
    clearTimeout(timer);

    // 리다이렉트 처리 (매번 재검사)
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return await readBody(res, currentUrl);
      if (redirects >= MAX_REDIRECTS) {
        throw new SafeFetchError('리다이렉트 횟수 초과');
      }
      const next = new URL(loc, currentUrl);
      assertSafeUrl(next.toString());
      currentUrl = next.toString();
      continue;
    }

    return await readBody(res, currentUrl);
  }
  throw new SafeFetchError('리다이렉트 횟수 초과');
}

async function readBody(res: Response, url: string): Promise<SafeResponse> {
  const lenHeader = res.headers.get('content-length');
  if (lenHeader && Number(lenHeader) > MAX_BYTES) {
    throw new SafeFetchError('본문이 2MB를 초과했습니다');
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    throw new SafeFetchError('본문이 2MB를 초과했습니다');
  }
  return {
    status: res.status,
    headers: res.headers,
    text: new TextDecoder('utf-8').decode(buf),
    url,
  };
}

// 테스트 노출
export const _internal = { isBlockedHost, isBlockedIpv4, assertSafeUrl };
