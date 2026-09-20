// backend/src/api/router.ts
// 프레임워크 없는 라우터. HTTP API payload v2 를 파싱해 method+path 패턴으로 매칭.

export interface ApiEvent {
  requestContext?: { http?: { method?: string } };
  rawPath?: string;
  rawQueryString?: string;
  body?: string;
  isBase64Encoded?: boolean;
}

export interface ApiResult {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

export interface ReqContext {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  json<T = unknown>(): T | undefined;
  raw: ApiEvent;
}

export type Handler = (ctx: ReqContext) => Promise<ApiResult> | ApiResult;

interface Route {
  method: string;
  // 세그먼트 배열. ':' 로 시작하면 파라미터.
  segments: string[];
  handler: Handler;
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json(statusCode: number, obj: unknown): ApiResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(obj),
  };
}

export function errorResult(statusCode: number, code: string, message: string): ApiResult {
  return json(statusCode, { error: { code, message } });
}

function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method: method.toUpperCase(), segments: splitPath(pattern), handler });
    return this;
  }

  get(p: string, h: Handler) {
    return this.add('GET', p, h);
  }
  post(p: string, h: Handler) {
    return this.add('POST', p, h);
  }
  patch(p: string, h: Handler) {
    return this.add('PATCH', p, h);
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | undefined {
    const segs = splitPath(path);
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      if (route.segments.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const rs = route.segments[i];
        if (rs.startsWith(':')) {
          params[rs.slice(1)] = decodeURIComponent(segs[i]);
        } else if (rs !== segs[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { route, params };
    }
    return undefined;
  }

  async handle(event: ApiEvent): Promise<ApiResult> {
    const method = event.requestContext?.http?.method ?? 'GET';
    const path = event.rawPath ?? '/';
    const found = this.match(method, path);
    if (!found) {
      return errorResult(404, 'not_found', '요청하신 경로를 찾을 수 없습니다.');
    }

    const query = new URLSearchParams(event.rawQueryString ?? '');
    let parsedBody: unknown;
    const ctx: ReqContext = {
      method: method.toUpperCase(),
      path,
      params: found.params,
      query,
      raw: event,
      json<T = unknown>(): T | undefined {
        if (parsedBody !== undefined) return parsedBody as T;
        if (!event.body) return undefined;
        const text = event.isBase64Encoded
          ? Buffer.from(event.body, 'base64').toString('utf-8')
          : event.body;
        try {
          parsedBody = JSON.parse(text);
        } catch {
          throw new ApiError(400, 'bad_json', '요청 본문이 올바른 JSON이 아닙니다.');
        }
        return parsedBody as T;
      },
    };

    try {
      return await found.route.handler(ctx);
    } catch (e) {
      if (e instanceof ApiError) {
        return errorResult(e.statusCode, e.code, e.message);
      }
      // 예상 못한 예외: 내부 메시지 노출 최소화
      console.error('API 처리 오류:', (e as Error).message);
      return errorResult(500, 'internal', '서버 처리 중 오류가 발생했습니다.');
    }
  }
}
