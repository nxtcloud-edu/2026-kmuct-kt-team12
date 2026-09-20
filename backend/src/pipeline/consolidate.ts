// backend/src/pipeline/consolidate.ts
// 3단계 통합: 전체 Evidence 를 같은 활동끼리 묶는다. AI 는 그룹(어느 근거끼리 한 활동인지)만 낸다.
// activityId 부여, 각 Evidence 가 정확히 한 활동에 속하는지 보장, 기간 추론은 코드가 한다.

import type { Deps, BedrockToolCall } from '../ports.js';
import type { Evidence } from '../../../shared/types.js';
import { contentId } from '../util.js';

export interface GroupToolResult {
    groups: Array<{ evidenceIds: string[] }>;
}

const GROUP_SCHEMA = {
    type: 'object',
    properties: {
        groups: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    evidenceIds: { type: 'array', items: { type: 'string' } },
                },
                required: ['evidenceIds'],
            },
        },
    },
    required: ['groups'],
};

function buildPrompt(evidence: Evidence[]): string {
    const lines = evidence.map((e) => `- ${e.id} [${e.field}] ${e.claim}`);
    return [
        '아래 근거들을 같은 활동(프로젝트/동아리/공모전 등)을 가리키는 것끼리 묶어라.',
        '각 근거는 정확히 하나의 그룹에만 속해야 한다. 판단이 서지 않는 근거는 단독 그룹으로 둔다.',
        '',
        ...lines,
    ].join('\n');
}

export interface ConsolidateOutcome {
    /** activityId 가 채워진 Evidence 들 */
    evidence: Evidence[];
    /** 활동 수 */
    activityCount: number;
    /** 여러 근거가 하나로 합쳐진 그룹들의 (그룹당 근거수) — "N개 링크가 합쳐졌습니다" 메시지용 */
    mergedGroupSizes: number[];
}

/**
 * Evidence 목록을 활동으로 묶고 activityId 를 부여한다.
 * AI 그룹 결과가 일부 Evidence 를 빠뜨리면, 빠진 것은 각각 단독 활동으로 만든다(정확히 한 활동 보장).
 */
export async function consolidateActivities(
    evidence: Evidence[],
    deps: Deps,
): Promise<ConsolidateOutcome> {
    if (evidence.length === 0) {
        return { evidence: [], activityCount: 0, mergedGroupSizes: [] };
    }

    const call: BedrockToolCall<GroupToolResult> = {
        prompt: buildPrompt(evidence),
        toolName: 'group_activities',
        schema: GROUP_SCHEMA,
    };
    const result = await deps.bedrock.invokeTool(call);

    const byId = new Map(evidence.map((e) => [e.id, e]));
    const assigned = new Set<string>();
    const out: Evidence[] = [];
    const mergedGroupSizes: number[] = [];
    let activityCount = 0;

    for (const group of result.groups ?? []) {
        const ids = (group.evidenceIds ?? []).filter((id) => byId.has(id) && !assigned.has(id));
        if (ids.length === 0) continue;
        const activityId = contentId('act', ...[...ids].sort());
        activityCount++;
        for (const id of ids) {
            assigned.add(id);
            out.push({ ...byId.get(id)!, activityId });
        }
        if (ids.length >= 2) mergedGroupSizes.push(ids.length);
    }

    // AI 가 빠뜨린 Evidence 는 각각 단독 활동으로
    for (const e of evidence) {
        if (!assigned.has(e.id)) {
            const activityId = contentId('act', e.id);
            activityCount++;
            assigned.add(e.id);
            out.push({ ...e, activityId });
        }
    }

    return { evidence: out, activityCount, mergedGroupSizes };
}
