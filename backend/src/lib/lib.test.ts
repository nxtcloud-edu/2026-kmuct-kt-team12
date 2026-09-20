import { describe, it, expect, vi } from 'vitest';
import { escape } from './html.js';
import { _internal as sfInternal, safeFetch, SafeFetchError } from './safeFetch.js';
import { MemoryStore, pk, SK } from './db.js';
import { runJob, createJob, hasRunningJob, sessionIdOfJob, makeJobId, lowOnTime } from './jobs.js';
import { dispatchJob, parseJobEvent, configFromEnv } from './dispatch.js';
import { converse, extractToolInput } from './bedrock.js';

describe('html.escape', () => {
  it('특수문자를 엔티티로 바꾼다', () => {
    expect(escape('<script>alert("x")&\'')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;',
    );
  });
  it('script 태그가 실행 가능한 형태로 남지 않는다', () => {
    const out = escape('<script>evil()</script>');
    expect(out).not.toContain('<script>');
  });
  it('null/undefined는 빈 문자열', () => {
    expect(escape(null)).toBe('');
    expect(escape(undefined)).toBe('');
  });
});

describe('safeFetch 차단 목록', () => {
  const blocked = [
    'http://localhost/x',
    'http://127.0.0.1/x',
    'http://10.1.2.3/x',
    'http://172.16.0.1/x',
    'http://172.31.255.1/x',
    'http://192.168.0.1/x',
    'http://169.254.169.254/latest/meta-data', // 메타데이터 엔드포인트
    'http://[::1]/x',
    'http://0.0.0.0/x',
    'ftp://example.com/x',
  ];
  for (const url of blocked) {
    it(`차단: ${url}`, async () => {
      await expect(safeFetch(url, { fetchImpl: vi.fn() as unknown as typeof fetch })).rejects.toBeInstanceOf(
        SafeFetchError,
      );
    });
  }

  it('허용 호스트는 통과하고 172.15/172.32는 사설 아님', () => {
    expect(sfInternal.isBlockedHost('example.com')).toBe(false);
    expect(sfInternal.isBlockedIpv4('172.15.0.1')).toBe(false);
    expect(sfInternal.isBlockedIpv4('172.32.0.1')).toBe(false);
    expect(sfInternal.isBlockedIpv4('8.8.8.8')).toBe(false);
  });

  it('리다이렉트가 사설 IP로 향하면 차단', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: 'http://169.254.169.254/' }),
        arrayBuffer: async () => new ArrayBuffer(0),
      });
    await expect(
      safeFetch('https://example.com/', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(SafeFetchError);
  });

  it('정상 200 응답 본문을 읽는다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => new TextEncoder().encode('hello').buffer,
    });
    const r = await safeFetch('https://example.com/', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.text).toBe('hello');
    expect(r.status).toBe(200);
  });
});

describe('jobs', () => {
  it('jobId에서 sessionId 역산 (마지막 점 앞)', () => {
    const sid = 'a.b.c'; // UUID엔 점이 없지만 방어적으로
    const jid = makeJobId(sid);
    expect(sessionIdOfJob(jid)).toBe(sid);
  });

  it('runJob은 중복 실행을 막고 예외를 잡아 failed 처리', async () => {
    const store = new MemoryStore();
    const sid = 'sess1';
    const job = await createJob(store, sid, 'keywords', '시작');

    // 정상 실행
    let ran = 0;
    await runJob(store, sid, job.id, async () => {
      ran++;
    });
    let it = await store.get(pk(sid), SK.job(job.id));
    expect(it?.status).toBe('done');
    expect(ran).toBe(1);

    // 이미 startedAt 있으므로 중복 실행 안 됨
    await runJob(store, sid, job.id, async () => {
      ran++;
    });
    expect(ran).toBe(1);
  });

  it('runJob은 예외를 던지지 않고 failed + 한국어 사유', async () => {
    const store = new MemoryStore();
    const sid = 'sess2';
    const job = await createJob(store, sid, 'generate', '시작');
    await expect(
      runJob(store, sid, job.id, async () => {
        throw new Error('부메랑');
      }),
    ).resolves.toBeUndefined();
    const it = await store.get(pk(sid), SK.job(job.id));
    expect(it?.status).toBe('failed');
    const events = it?.events as { message: string }[];
    expect(events.some((e) => e.message.includes('실패'))).toBe(true);
  });

  it('hasRunningJob은 running Job을 감지', async () => {
    const store = new MemoryStore();
    const sid = 'sess3';
    expect(await hasRunningJob(store, sid)).toBe(false);
    await createJob(store, sid, 'collect', '시작');
    expect(await hasRunningJob(store, sid)).toBe(true);
  });

  it('lowOnTime: 30초 미만이면 true', () => {
    expect(lowOnTime({ getRemainingTimeInMillis: () => 29_000 })).toBe(true);
    expect(lowOnTime({ getRemainingTimeInMillis: () => 31_000 })).toBe(false);
    expect(lowOnTime(undefined)).toBe(false);
  });
});

describe('dispatch', () => {
  it('parseJobEvent: SQS 이벤트와 직접호출 모두 처리', () => {
    const direct = { sessionId: 's', jobId: 's.1', kind: 'collect' as const };
    expect(parseJobEvent(direct)).toEqual([direct]);

    const sqs = { Records: [{ body: JSON.stringify(direct) }] };
    expect(parseJobEvent(sqs)).toEqual([direct]);
  });

  it('invoke 모드: collector 함수로 Event 호출', async () => {
    const send = vi.fn().mockResolvedValue({});
    const makeInvoke = vi.fn((i) => i);
    await dispatchJob(
      { sessionId: 's', jobId: 's.1', kind: 'collect' },
      {
        config: { mode: 'invoke', collectorFn: 'COL', aiWorkerFn: 'AI' },
        lambdaClient: { send },
        makeInvoke,
      },
    );
    expect(makeInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ FunctionName: 'COL', InvocationType: 'Event' }),
    );
    expect(send).toHaveBeenCalled();
  });

  it('sqs 모드: ai-worker 큐로 전송', async () => {
    const send = vi.fn().mockResolvedValue({});
    const makeSend = vi.fn((i) => i);
    await dispatchJob(
      { sessionId: 's', jobId: 's.1', kind: 'keywords' },
      {
        config: { mode: 'sqs', collectorQueueUrl: 'CQ', aiWorkerQueueUrl: 'AQ' },
        sqsClient: { send },
        makeSend,
      },
    );
    expect(makeSend).toHaveBeenCalledWith(expect.objectContaining({ QueueUrl: 'AQ' }));
  });

  it('configFromEnv 기본은 invoke', () => {
    expect(configFromEnv({} as NodeJS.ProcessEnv).mode).toBe('invoke');
    expect(configFromEnv({ DISPATCH_MODE: 'sqs' } as NodeJS.ProcessEnv).mode).toBe('sqs');
  });
});

describe('bedrock(게이트웨이)', () => {
  const ARGS = {
    system: 's',
    userText: 'u',
    maxTokens: 10,
    tool: { name: 't', description: 'd', schema: { type: 'object' } },
  };
  const DEPS = { modelId: 'bedrock-haiku', baseUrl: 'https://gw.test/v1', apiKey: 'sk-test' };

  function okResponse(args: unknown) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { tool_calls: [{ function: { name: 't', arguments: JSON.stringify(args) } }] } }],
      }),
    } as unknown as Response;
  }

  it('extractToolInput은 tool_calls의 arguments(JSON 문자열)만 읽는다', () => {
    const res = {
      choices: [
        {
          message: {
            content: '무시할 산문',
            tool_calls: [{ function: { name: 't', arguments: '{"ok":1}' } }],
          },
        },
      ],
    };
    expect(extractToolInput(res, 't')).toEqual({ ok: 1 });
  });

  it('tool_calls가 없으면 던진다 (자유 텍스트를 받아들이지 않는다)', () => {
    const res = { choices: [{ message: { content: '{"ok":1}' } }] };
    expect(() => extractToolInput(res, 't')).toThrow('도구 결과를 반환하지 않았습니다');
  });

  it('요청 본문에 tool_choice로 스키마를 강제한다', async () => {
    let sent: any;
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      sent = JSON.parse(init.body);
      return okResponse({ v: 1 });
    }) as unknown as typeof fetch;

    await converse(ARGS, { ...DEPS, fetchImpl });

    expect((fetchImpl as any).mock.calls[0][0]).toBe('https://gw.test/v1/chat/completions');
    expect((fetchImpl as any).mock.calls[0][1].headers.Authorization).toBe('Bearer sk-test');
    expect(sent.model).toBe('bedrock-haiku');
    expect(sent.tool_choice).toEqual({ type: 'function', function: { name: 't' } });
    expect(sent.tools[0].function.parameters).toEqual({ type: 'object' });
    expect(sent.max_tokens).toBe(10);
  });

  it('429는 재시도 후 성공', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) {
        return { ok: false, status: 429, text: async () => 'rate limited' } as unknown as Response;
      }
      return okResponse({ v: 2 });
    }) as unknown as typeof fetch;

    const out = await converse<{ v: number }>(ARGS, { ...DEPS, fetchImpl });
    expect(out).toEqual({ v: 2 });
    expect(calls).toBe(2);
  });

  it('400은 재시도하지 않고 즉시 던진다', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return { ok: false, status: 400, text: async () => 'bad request' } as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(converse(ARGS, { ...DEPS, fetchImpl })).rejects.toThrow('게이트웨이 호출 실패(400)');
    expect(calls).toBe(1);
  });

  it('키가 없으면 호출 전에 던진다', async () => {
    const prev = process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEY;
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      converse(ARGS, { modelId: 'bedrock-haiku', baseUrl: 'https://gw.test/v1', fetchImpl }),
    ).rejects.toThrow('LLM_API_KEY');
    expect((fetchImpl as any).mock.calls.length).toBe(0);
    if (prev !== undefined) process.env.LLM_API_KEY = prev;
  });
}, 20000);
