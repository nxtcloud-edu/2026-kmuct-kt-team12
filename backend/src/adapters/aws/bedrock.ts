// backend/src/adapters/aws/bedrock.ts
// Bedrock Converse API 어댑터. tool use(JSON 스키마 강제)로만 호출.

import {
    BedrockRuntimeClient,
    ConverseCommand,
    type ContentBlock,
    type ToolConfiguration,
    type Message,
} from '@aws-sdk/client-bedrock-runtime';
import type { BedrockPort, BedrockToolCall } from '../../ports.js';
import { retry } from '../../util.js';

export class BedrockConverse implements BedrockPort {
    private client: BedrockRuntimeClient;
    private modelId: string;

    constructor(modelId: string, client?: BedrockRuntimeClient) {
        this.modelId = modelId;
        this.client = client ?? new BedrockRuntimeClient({});
    }

    async invokeTool<T>(call: BedrockToolCall<T>): Promise<T> {
        const content: ContentBlock[] = [{ text: call.prompt }];

        // 첨부 파일(PDF/이미지) 처리
        if (call.attachments) {
            for (const att of call.attachments) {
                if (att.kind === 'document' && att.bytes) {
                    content.push({
                        document: {
                            format: 'pdf',
                            name: att.name ?? 'document',
                            source: { bytes: att.bytes },
                        },
                    });
                } else if (att.kind === 'image' && att.bytes) {
                    content.push({
                        image: {
                            format: (att.mediaType?.split('/')[1] ?? 'png') as 'png' | 'jpeg' | 'gif' | 'webp',
                            source: { bytes: att.bytes },
                        },
                    });
                }
            }
        }

        const messages: Message[] = [{ role: 'user', content }];

        const toolConfig: ToolConfiguration = {
            tools: [{
                toolSpec: {
                    name: call.toolName,
                    description: `Extract structured data as ${call.toolName}`,
                    inputSchema: { json: call.schema },
                },
            }],
            toolChoice: { tool: { name: call.toolName } },
        };

        const result = await retry(async () => {
            const res = await this.client.send(new ConverseCommand({
                modelId: this.modelId,
                messages,
                toolConfig,
            }));
            const toolUse = res.output?.message?.content?.find((b) => 'toolUse' in b);
            if (!toolUse || !('toolUse' in toolUse)) {
                throw new Error('Bedrock 응답에 toolUse 블록이 없음');
            }
            return toolUse.toolUse!.input as T;
        }, { attempts: 3, baseMs: 1000 });

        return result;
    }
}
