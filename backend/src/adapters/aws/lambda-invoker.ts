// backend/src/adapters/aws/lambda-invoker.ts
// Lambda 비동기 호출로 다음 단계를 트리거하는 JobInvoker 구현.

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { JobInvoker, Job } from '../../ports.js';

export class LambdaJobInvoker implements JobInvoker {
    private lambda: LambdaClient;
    private collectorFn: string;
    private pipelineFn: string;

    constructor(collectorFnName: string, pipelineFnName: string, client?: LambdaClient) {
        this.collectorFn = collectorFnName;
        this.pipelineFn = pipelineFnName;
        this.lambda = client ?? new LambdaClient({});
    }

    async invoke(job: Job): Promise<void> {
        const functionName = job.kind === 'collect' ? this.collectorFn : this.pipelineFn;
        await this.lambda.send(new InvokeCommand({
            FunctionName: functionName,
            InvocationType: 'Event', // 비동기
            Payload: Buffer.from(JSON.stringify(job)),
        }));
    }
}
