// backend/src/pipeline/tailor.ts
// 5단계 직무 맞춤: MasterOutput + 직무 → TailoredOutput.
// 원문(Artifact)을 다시 읽지 않고 Evidence(마스터의 entries)만 입력으로 받는다.
// 근거 밖으로 나가지 않는 것을 validateTailored 가 강제한다.

import type { Deps, BedrockToolCall } from '../ports.js';
import type {
    MasterOutput,
    TailoredOutput,
    ActivityEntry,
    Competency,
    Sentence,
} from '../../../shared/types.js';
import { validateTailored } from '../../../shared/validators.js';

// ---------- 직무 해석 ----------
export interface RoleToolResult {
    competencies: Array<{ name: string }>;
}

const ROLE_SCHEMA = {
    type: 'object',
    properties: {
        competencies: {
            type: 'array',
            minItems: 5,
            maxItems: 8,
            items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        },
    },
    required: ['competencies'],
};

/** 직무명/JD 에서 요구 역량 5~8개를 뽑는다. evidenceIds 는 아직 비어 있다(rank/retell 이 채움). */
export async function interpretRole(
    role: string,
    jdText: string | undefined,
    deps: Deps,
): Promise<Competency[]> {
    const call: BedrockToolCall<RoleToolResult> = {
        prompt: [
            `희망 직무: ${role}`,
            jdText ? `채용공고(JD):\n${jdText}` : '',
            '이 직무가 요구하는 핵심 역량 5~8개를 뽑아라.',
        ]
            .filter(Boolean)
            .join('\n'),
        toolName: 'extract_competencies',
        schema: ROLE_SCHEMA,
    };
    const result = await deps.bedrock.invokeTool(call);
    return (result.competencies ?? []).map((c) => ({ name: c.name, evidenceIds: [] }));
}

// ---------- 관련도 정렬 ----------
export interface RankToolResult {
    ranked: Array<{ activityId: string; score: number }>;
}

const RANK_SCHEMA = {
    type: 'object',
    properties: {
        ranked: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    activityId: { type: 'string' },
                    score: { type: 'number' },
                },
                required: ['activityId', 'score'],
            },
        },
    },
    required: ['ranked'],
};

/** 활동을 역량 관련도순으로 점수화한다. AI 추천 체크용 신호. */
export async function rankActivities(
    master: MasterOutput,
    competencies: Competency[],
    deps: Deps,
): Promise<Array<{ activityId: string; score: number }>> {
    if (master.entries.length === 0) return [];
    const call: BedrockToolCall<RankToolResult> = {
        prompt: [
            `요구 역량: ${competencies.map((c) => c.name).join(', ')}`,
            '아래 활동을 역량 관련도(0~1)로 점수화하라.',
            ...master.entries.map((e) => `- ${e.activityId} ${e.title.text} / ${e.summary.text}`),
        ].join('\n'),
        toolName: 'rank_activities',
        schema: RANK_SCHEMA,
    };
    const result = await deps.bedrock.invokeTool(call);
    const scoreById = new Map((result.ranked ?? []).map((r) => [r.activityId, r.score]));
    // AI 가 빠뜨린 활동은 0점
    return master.entries
        .map((e) => ({ activityId: e.activityId, score: scoreById.get(e.activityId) ?? 0 }))
        .sort((a, b) => b.score - a.score);
}

// ---------- 재서술 ----------
export interface RetellToolResult {
    intro: Sentence[];
    entries: ActivityEntry[];
    competencyEvidence: Array<{ name: string; evidenceIds: string[] }>;
}

const SENTENCE_SCHEMA = {
    type: 'object',
    properties: {
        text: { type: 'string' },
        evidenceIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
    },
    required: ['text', 'evidenceIds'],
};

const RETELL_SCHEMA = {
    type: 'object',
    properties: {
        intro: { type: 'array', items: SENTENCE_SCHEMA, minItems: 3, maxItems: 4 },
        entries: { type: 'array', items: { type: 'object' } },
        competencyEvidence: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    evidenceIds: { type: 'array', items: { type: 'string' } },
                },
                required: ['name', 'evidenceIds'],
            },
        },
    },
    required: ['intro', 'entries', 'competencyEvidence'],
};

function buildRetellPrompt(
    role: string,
    selected: ActivityEntry[],
    competencies: Competency[],
    allowedIds: string[],
    violations?: string[],
): string {
    const base = [
        `희망 직무: ${role}`,
        `요구 역량: ${competencies.map((c) => c.name).join(', ')}`,
        '아래 선택된 활동을 이 직무에 맞게 재서술하라. 새 사실을 추가하지 마라.',
        '모든 문장의 evidenceIds 는 아래 허용된 근거 id 중에서만 골라라.',
        `허용 근거 id: ${allowedIds.join(', ')}`,
        '상단 자기소개(intro) 3~4문장도 선택된 근거만으로 작성하라.',
        'JD 가 요구하지만 근거가 없는 역량은 competencyEvidence 에서 evidenceIds 를 빈 배열로 두어라(공백 리포트).',
        '',
        '선택된 활동:',
        ...selected.map((e) => `- ${e.activityId} ${e.title.text}`),
    ];
    if (violations?.length) {
        base.push('', '이전 위반(고칠 것):', ...violations.map((v) => `- ${v}`));
    }
    return base.join('\n');
}

// ---------- 조립 ----------
/**
 * 선택된 활동만으로 직무 맞춤본을 만든다.
 * allowedEvidenceIds = 선택된 활동에 속한 Evidence id 집합.
 * validateTailored 위반 시 1회 재시도, 그래도 위반이면 위반 문장 제거.
 */
export async function composeTailored(
    portfolioId: string,
    master: MasterOutput,
    role: string,
    jdText: string | undefined,
    selectedActivityIds: string[],
    allowedEvidenceIdsByActivity: Map<string, string[]>,
    deps: Deps,
): Promise<TailoredOutput> {
    const competencies = await interpretRole(role, jdText, deps);

    const selected = master.entries.filter((e) => selectedActivityIds.includes(e.activityId));
    const allowedIds = selected.flatMap((e) => allowedEvidenceIdsByActivity.get(e.activityId) ?? []);
    const allowed = new Set(allowedIds);

    const call = (violations?: string[]): BedrockToolCall<RetellToolResult> => ({
        prompt: buildRetellPrompt(role, selected, competencies, allowedIds, violations),
        toolName: 'retell_for_role',
        schema: RETELL_SCHEMA,
    });

    let retold = await deps.bedrock.invokeTool(call());
    let output = assemble(portfolioId, role, jdText, competencies, retold, master, deps);
    let violations = validateTailored(output, allowed);
    if (violations.length > 0) {
        retold = await deps.bedrock.invokeTool(call(violations));
        output = assemble(portfolioId, role, jdText, competencies, retold, master, deps);
        violations = validateTailored(output, allowed);
        if (violations.length > 0) {
            output = stripInvalid(output, allowed);
        }
    }
    return output;
}

function assemble(
    portfolioId: string,
    role: string,
    jdText: string | undefined,
    baseCompetencies: Competency[],
    retold: RetellToolResult,
    master: MasterOutput,
    deps: Deps,
): TailoredOutput {
    // 역량별 근거를 채운다(공백 리포트: 근거 없으면 빈 배열 유지)
    const evByName = new Map((retold.competencyEvidence ?? []).map((c) => [c.name, c.evidenceIds]));
    const competencies: Competency[] = baseCompetencies.map((c) => ({
        name: c.name,
        evidenceIds: evByName.get(c.name) ?? [],
    }));

    return {
        kind: 'tailored',
        id: deps.id.next('tail'),
        portfolioId,
        targetRole: role,
        ...(jdText ? { jdText } : {}),
        competencies,
        intro: retold.intro ?? [],
        entries: retold.entries ?? [],
        basedOnMasterAt: master.generatedAt,
        generatedAt: deps.clock.now(),
    };
}

function stripInvalid(output: TailoredOutput, allowed: Set<string>): TailoredOutput {
    const ok = (s: Sentence) => s.evidenceIds.length > 0 && s.evidenceIds.every((id) => allowed.has(id));
    const filt = (arr: Sentence[]) => arr.filter(ok);
    return {
        ...output,
        intro: filt(output.intro),
        entries: output.entries.map((e) => ({
            ...e,
            what: filt(e.what),
            how: filt(e.how),
            result: filt(e.result),
            outcome: e.outcome ? filt(e.outcome) : null,
            affiliationRole: e.affiliationRole && ok(e.affiliationRole) ? e.affiliationRole : null,
        })),
        // competencies: 허용 밖 근거는 제거(빈 배열이면 공백 리포트로 유지)
        competencies: output.competencies.map((c) => ({
            name: c.name,
            evidenceIds: c.evidenceIds.filter((id) => allowed.has(id)),
        })),
    };
}

/** 마스터가 맞춤본보다 새로운지(원본이 바뀜 표시). */
export function isMasterNewer(master: MasterOutput, tailored: TailoredOutput): boolean {
    return master.generatedAt > tailored.basedOnMasterAt;
}
