// backend/src/adapters/aws/fetch-http.ts
// Node.js fetch 기반 HttpPort 구현.

import type { HttpPort, HttpResponse } from '../../ports.js';

export class FetchHttp implements HttpPort {
    async get(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
        const res = await fetch(url, { headers });
        const body = await res.text();
        const h: Record<string, string> = {};
        res.headers.forEach((v, k) => { h[k] = v; });
        return { status: res.status, body, headers: h };
    }
}
