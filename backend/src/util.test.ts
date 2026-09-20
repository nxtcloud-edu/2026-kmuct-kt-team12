// backend/src/util.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256, mapWithConcurrency, retry, seqIdGen, fixedClock } from './util.js';

test('sha256: 같은 입력은 같은 해시, 다른 입력은 다른 해시', () => {
    assert.equal(sha256('abc'), sha256('abc'));
    assert.notEqual(sha256('abc'), sha256('abd'));
    assert.match(sha256('x'), /^[0-9a-f]{64}$/);
});

test('mapWithConcurrency: 순서 보존, 동시 수 제한 준수', async () => {
    let active = 0;
    let maxActive = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return n * 10;
    });
    assert.deepEqual(out, [10, 20, 30, 40, 50]);
    assert.ok(maxActive <= 2, `동시 실행이 2를 넘음: ${maxActive}`);
});

test('mapWithConcurrency: 에러 전파', async () => {
    await assert.rejects(
        mapWithConcurrency([1, 2], 2, async (n) => {
            if (n === 2) throw new Error('boom');
            return n;
        }),
        /boom/,
    );
});

test('retry: 실패 후 성공하면 결과 반환', async () => {
    let calls = 0;
    const r = await retry(
        async () => {
            calls++;
            if (calls < 3) throw new Error('일시 실패');
            return 'ok';
        },
        { attempts: 3, baseMs: 1, sleep: async () => {} },
    );
    assert.equal(r, 'ok');
    assert.equal(calls, 3);
});

test('seqIdGen/fixedClock: 결정적', () => {
    const id = seqIdGen();
    assert.equal(id.next('run'), 'run_1');
    assert.equal(id.next('run'), 'run_2');
    assert.equal(id.next('art'), 'art_1');
    assert.equal(fixedClock('2026-01-01T00:00:00Z').now(), '2026-01-01T00:00:00Z');
});
