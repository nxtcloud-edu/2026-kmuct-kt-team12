// backend/src/lib/dispatch.ts
// api Lambda가 작업 Lambda(collector/ai-worker)를 깨우는 방법.
// DISPATCH_MODE = "invoke"(LambdaClient InvokeCommand Event) | "sqs"(SQSClient SendMessage)

import type { JobKind, Connections } from '../types.js';

export const REGION = 'us-east-1';

export interface JobPayload {
  sessionId: string;
  jobId: string;
  kind: JobKind;
  connections?: Connections;
}

export interface DispatchConfig {
  mode: 'invoke' | 'sqs';
  collectorFn?: string;
  aiWorkerFn?: string;
  collectorQueueUrl?: string;
  aiWorkerQueueUrl?: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): DispatchConfig {
  return {
    mode: env.DISPATCH_MODE === 'sqs' ? 'sqs' : 'invoke',
    collectorFn: env.COLLECTOR_FN,
    aiWorkerFn: env.AI_WORKER_FN,
    collectorQueueUrl: env.COLLECTOR_QUEUE_URL,
    aiWorkerQueueUrl: env.AI_WORKER_QUEUE_URL,
  };
}

function isCollector(kind: JobKind): boolean {
  return kind === 'collect';
}

// 테스트 주입용 클라이언트 인터페이스
export interface Dispatcher {
  send(command: unknown): Promise<unknown>;
}

export interface DispatchDeps {
  config: DispatchConfig;
  lambdaClient?: Dispatcher;
  sqsClient?: Dispatcher;
  makeInvoke?: (input: unknown) => unknown;
  makeSend?: (input: unknown) => unknown;
}

export async function dispatchJob(payload: JobPayload, deps: DispatchDeps): Promise<void> {
  const { config } = deps;
  const collector = isCollector(payload.kind);

  if (config.mode === 'invoke') {
    const fn = collector ? config.collectorFn : config.aiWorkerFn;
    if (!fn) throw new Error('대상 Lambda 함수 이름이 설정되지 않았습니다');
    let client = deps.lambdaClient;
    let makeInvoke = deps.makeInvoke;
    if (!client || !makeInvoke) {
      const mod = await import('@aws-sdk/client-lambda');
      client = client ?? (new mod.LambdaClient({ region: REGION }) as unknown as Dispatcher);
      makeInvoke =
        makeInvoke ??
        ((input: unknown) => new mod.InvokeCommand(input as any));
    }
    await client.send(
      makeInvoke({
        FunctionName: fn,
        InvocationType: 'Event',
        Payload: new TextEncoder().encode(JSON.stringify(payload)),
      }),
    );
    return;
  }

  // sqs
  const url = collector ? config.collectorQueueUrl : config.aiWorkerQueueUrl;
  if (!url) throw new Error('대상 큐 URL이 설정되지 않았습니다');
  let client = deps.sqsClient;
  let makeSend = deps.makeSend;
  if (!client || !makeSend) {
    const mod = await import('@aws-sdk/client-sqs');
    client = client ?? (new mod.SQSClient({ region: REGION }) as unknown as Dispatcher);
    makeSend = makeSend ?? ((input: unknown) => new mod.SendMessageCommand(input as any));
  }
  await client.send(
    makeSend({ QueueUrl: url, MessageBody: JSON.stringify(payload) }),
  );
}

// 작업 Lambda 진입에서 직접호출 이벤트와 SQS 이벤트 양쪽을 JobPayload[] 로 정규화
export function parseJobEvent(event: unknown): JobPayload[] {
  const e = event as { Records?: Array<{ body?: string }> };
  if (e && Array.isArray(e.Records)) {
    return e.Records.map((r) => JSON.parse(r.body ?? '{}') as JobPayload);
  }
  return [event as JobPayload];
}
