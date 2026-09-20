// backend/src/util.ts
import { createHash, randomUUID } from 'node:crypto';
import type { Clock, IdGen } from './ports.js';

/** sha256(text) 16진수. Artifact.contentHash 용. */
export function sha256(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 내용 기반 결정적 짧은 id. 같은 입력이면 같은 id (refresh 간 정체성 유지에 쓴다). */
export function contentId(prefix: string, ...parts: string[]): string {
    const h = createHash('sha256').update(parts.join('\u0000'), 'utf8').digest('hex').slice(0, 16);
    return `${prefix}_${h}`;
}

/**
 * items 를 limit 개씩 동시 실행하며 fn 을 적용한다. 결과 순서는 입력 순서를 보존한다.
 * 2단계 추출의 출처별 병렬에 쓴다. 에러는 그대로 전파한다.
 */
export async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    if (limit < 1) limit = 1;
    const results: R[] = new Array(items.length);
    let cursor = 0;

    async function worker(): Promise<void> {
        while (true) {
            const i = cursor++;
            if (i >= items.length) return;
            results[i] = await fn(items[i], i);
        }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

/** 지수 백오프 재시도. Bedrock 등 호출 한도 대비. */
export async function retry<T>(
    fn: () => Promise<T>,
    opts: { attempts?: number; baseMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
    const attempts = opts.attempts ?? 3;
    const baseMs = opts.baseMs ?? 200;
    const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            if (i < attempts - 1) await sleep(baseMs * 2 ** i);
        }
    }
    throw lastErr;
}

export const systemClock: Clock = {
    now: () => new Date().toISOString(),
};

export const uuidIdGen: IdGen = {
    next: (prefix: string) => `${prefix}_${randomUUID()}`,
};

/** 테스트용 결정적 클록. */
export function fixedClock(iso: string): Clock {
    return { now: () => iso };
}

/** 테스트용 결정적 id 생성기. */
export function seqIdGen(): IdGen {
    const counters = new Map<string, number>();
    return {
        next(prefix: string): string {
            const n = (counters.get(prefix) ?? 0) + 1;
            counters.set(prefix, n);
            return `${prefix}_${n}`;
        },
    };
}
