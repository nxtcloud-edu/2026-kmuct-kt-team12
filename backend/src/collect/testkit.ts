// backend/src/collect/testkit.ts
// 수집 테스트용 모킹 HttpPort. URL(부분 일치)별 고정 응답을 돌려준다.

import type { HttpPort, HttpResponse } from '../ports.js';

export interface MockRoute {
    match: string; // URL 에 이 문자열이 포함되면 매칭
    status?: number;
    body: string;
    headers?: Record<string, string>;
}

export function mockHttp(routes: MockRoute[]): HttpPort & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        async get(url: string): Promise<HttpResponse> {
            calls.push(url);
            // 더 긴 match 를 우선(구체적인 라우트 먼저)
            const sorted = [...routes].sort((a, b) => b.match.length - a.match.length);
            const r = sorted.find((route) => url.includes(route.match));
            if (!r) return { status: 404, body: '', headers: {} };
            return { status: r.status ?? 200, body: r.body, headers: r.headers ?? {} };
        },
    };
}
