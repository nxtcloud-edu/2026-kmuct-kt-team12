// backend/src/testkit.ts
// 테스트용 Deps 조립기. 인메모리 store/blob + 주입 가능한 bedrock/http.

import type { Deps, BedrockPort, HttpPort, BedrockToolCall } from './ports.js';
import { MemoryStore, MemoryBlob } from './adapters/memory.js';
import { fixedClock, seqIdGen } from './util.js';

/** 항상 지정한 값을 돌려주는 Bedrock 스텁. 호출 로그를 남긴다. */
export function stubBedrock(
    handler: (call: BedrockToolCall<unknown>) => unknown,
): BedrockPort & { calls: BedrockToolCall<unknown>[] } {
    const calls: BedrockToolCall<unknown>[] = [];
    return {
        calls,
        async invokeTool<T>(call: BedrockToolCall<T>): Promise<T> {
            calls.push(call as BedrockToolCall<unknown>);
            return handler(call as BedrockToolCall<unknown>) as T;
        },
    };
}

export const noopHttp: HttpPort = {
    async get() {
        return { status: 404, body: '', headers: {} };
    },
};

export function makeDeps(over: Partial<Deps> = {}): Deps {
    return {
        store: over.store ?? new MemoryStore(),
        blob: over.blob ?? new MemoryBlob(),
        bedrock: over.bedrock ?? stubBedrock(() => ({})),
        http: over.http ?? noopHttp,
        clock: over.clock ?? fixedClock('2026-09-20T00:00:00.000Z'),
        id: over.id ?? seqIdGen(),
        env: {
            EXTRACT_CONCURRENCY: 3,
            BEDROCK_MODEL_ID: 'test-model',
            RAWTEXT_SPILL_LIMIT: 40000,
            ...over.env,
        },
    };
}
