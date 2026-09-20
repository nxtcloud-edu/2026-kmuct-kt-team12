// backend/src/pipeline/extract.ts
// 2단계 추출: Artifact 원문에서 사실 단위(Evidence)를 뽑는다.
// AI 는 인용문(quote)과 필드/claim 만 낸다. start/end 위치는 코드(verifyQuote)가 계산한다.
// verifyQuote 를 통과 못 한 후보는 버린다(환각 방지를 코드가 강제).

import type { Deps, BedrockToolCall } from '../ports.js';
import type { Artifact, Evidence, EvidenceField } from '../../../shared/types.js';
import { verifyQuote } from '../../../shared/validators.js';
import { contentId } from '../util.js';

const EVIDENCE_FIELDS: EvidenceField[] = [
    'title', 'type', 'period', 'affiliation', 'role',
    'what', 'how', 'result', 'tech', 'outcome',
];

/** AI 가 tool 로 넘기는 추출 결과 형태. start/end 는 받지 않는다. */
export interface ExtractToolResult {
    evidences: Array<{
        field: string;
        claim: string;
        quote: string;
    }>;
}

const EXTRACT_SCHEMA = {
    type: 'object',
    properties: {
        evidences: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    field: { type: 'string', enum: EVIDENCE_FIELDS },
                    claim: { type: 'string', description: '인용에서 읽어낸 사실, 중립 문체 한 문장' },
                    quote: { type: 'string', description: '원문 그대로의 인용. 반드시 원문에 존재해야 함' },
                },
                required: ['field', 'claim', 'quote'],
            },
        },
    },
    required: ['evidences'],
};

function buildPrompt(artifact: Artifact): string {
    return [
        '다음 원문에서 지원자의 활동 사실을 근거 단위로 추출하라.',
        '각 근거는 원문에 그대로 존재하는 인용문(quote)과, 그 인용에서 읽어낸 중립 문체의 사실 한 문장(claim),',
        '그리고 필드 분류(field)를 가진다. 원문에 없는 내용을 지어내지 마라.',
        '',
        '--- 원문 시작 ---',
        artifact.rawText,
        '--- 원문 끝 ---',
    ].join('\n');
}

export interface ExtractOutcome {
    evidence: Evidence[];
    keptCount: number;
    droppedCount: number;
}

/**
 * Artifact 하나에서 Evidence 를 추출한다.
 * 1) Bedrock tool use 로 {field, claim, quote} 목록을 받는다.
 * 2) 각 quote 를 verifyQuote 로 검사해 통과한 것만 Evidence 로 만든다(start/end 는 코드가 채움).
 */
export async function extractEvidence(artifact: Artifact, deps: Deps): Promise<ExtractOutcome> {
    const call: BedrockToolCall<ExtractToolResult> = {
        prompt: buildPrompt(artifact),
        toolName: 'record_evidence',
        schema: EXTRACT_SCHEMA,
    };
    const result = await deps.bedrock.invokeTool(call);

    const evidence: Evidence[] = [];
    let dropped = 0;
    for (const cand of result.evidences ?? []) {
        // 필드 검증(스키마 밖 값 방지)
        if (!EVIDENCE_FIELDS.includes(cand.field as EvidenceField)) {
            dropped++;
            continue;
        }
        const quoteRef = verifyQuote(artifact, cand.quote);
        if (!quoteRef) {
            dropped++; // 원문에 없는 인용 → 폐기
            continue;
        }
        evidence.push({
            id: contentId('evd', artifact.id, cand.field, cand.quote),
            field: cand.field as EvidenceField,
            claim: cand.claim,
            quoteRef,
        });
    }

    return { evidence, keptCount: evidence.length, droppedCount: dropped };
}
