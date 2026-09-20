// backend/src/pipeline/master.ts
// 4단계 마스터 작성: 활동별로 표준 폼(ActivityEntry)을 채운다.
// 모든 Sentence 는 evidenceIds 를 1개 이상 갖고, 그 id 는 그 활동의 근거 집합 안에 있어야 한다.
// validateEntry 로 검증하고, 위반 시 위반 내용을 프롬프트에 붙여 1회 재시도, 그래도 위반인 문장은 삭제한다.

import type { Deps, BedrockToolCall } from '../ports.js';
import type {
    Evidence,
    ActivityEntry,
    MasterOutput,
    Sentence,
    Period,
} from '../../../shared/types.js';
import { validateEntry } from '../../../shared/validators.js';

/** AI 가 tool 로 넘기는 활동 폼. 코드가 ActivityEntry 로 정규화한다. */
export interface EntryToolResult {
    title: Sentence;
    type: ActivityEntry['type'];
    period: Period | null;
    affiliationRole: Sentence | null;
    summary: Sentence;
    what: Sentence[];
    how: Sentence[];
    result: Sentence[];
    tech: string[];
    outcome: Sentence[] | null;
}

const SENTENCE_SCHEMA = {
    type: 'object',
    properties: {
        text: { type: 'string' },
        evidenceIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
    },
    required: ['text', 'evidenceIds'],
};

const ENTRY_SCHEMA = {
    type: 'object',
    properties: {
        title: SENTENCE_SCHEMA,
        type: { type: 'string', enum: ['project', 'club', 'contest', 'intern', 'study', 'etc'] },
        period: {
            type: ['object', 'null'],
            properties: {
                start: { type: 'string' },
                end: { type: 'string' },
                inferred: { type: 'boolean' },
                evidenceIds: { type: 'array', items: { type: 'string' } },
            },
        },
        affiliationRole: { type: ['object', 'null'], properties: SENTENCE_SCHEMA.properties },
        summary: SENTENCE_SCHEMA,
        what: { type: 'array', items: SENTENCE_SCHEMA },
        how: { type: 'array', items: SENTENCE_SCHEMA },
        result: { type: 'array', items: SENTENCE_SCHEMA },
        tech: { type: 'array', items: { type: 'string' } },
        outcome: { type: ['array', 'null'], items: SENTENCE_SCHEMA },
    },
    required: ['title', 'type', 'summary', 'what', 'how', 'result', 'tech'],
};

function buildPrompt(activityEvidence: Evidence[], violations?: string[]): string {
    const lines = activityEvidence.map((e) => `- ${e.id} [${e.field}] ${e.claim}`);
    const base = [
        '아래는 한 활동에 속한 근거들이다. 이 활동을 표준 폼(제목/유형/기간/소속·역할/요약/무엇/어떻게/결과/기술/성과)으로 채워라.',
        '모든 문장(Sentence)은 evidenceIds 를 1개 이상 가져야 하고, 그 id 는 아래 근거 id 중에서만 골라야 한다.',
        '근거가 없는 칸은 억지로 채우지 말고 비워라(null 또는 빈 배열). 기간을 추정했으면 inferred=true.',
        '',
        ...lines,
    ];
    if (violations && violations.length) {
        base.push(
            '',
            '이전 시도에서 다음 위반이 있었다. 이 문제를 고쳐라(없는 근거 id 를 쓰지 말 것):',
            ...violations.map((v) => `- ${v}`),
        );
    }
    return base.join('\n');
}

/** 위반 문장을 제거한다(evidenceIds 가 비었거나 허용 집합 밖인 Sentence). */
function stripInvalidSentences(entry: ActivityEntry, allowed: Set<string>): ActivityEntry {
    const ok = (s: Sentence) => s.evidenceIds.length > 0 && s.evidenceIds.every((id) => allowed.has(id));
    const filterArr = (arr: Sentence[]) => arr.filter(ok);
    return {
        ...entry,
        what: filterArr(entry.what),
        how: filterArr(entry.how),
        result: filterArr(entry.result),
        outcome: entry.outcome ? filterArr(entry.outcome) : null,
        affiliationRole: entry.affiliationRole && ok(entry.affiliationRole) ? entry.affiliationRole : null,
        // title, summary 가 위반이면 삭제할 수 없으므로(필수) 최소 근거를 남기되, 위반이면 evidenceIds 를 비워두지 않는다.
    };
}

function toEntry(activityId: string, sourceIds: string[], r: EntryToolResult): ActivityEntry {
    return {
        activityId,
        title: r.title,
        type: r.type,
        period: r.period ?? null,
        affiliationRole: r.affiliationRole ?? null,
        summary: r.summary,
        what: r.what ?? [],
        how: r.how ?? [],
        result: r.result ?? [],
        tech: r.tech ?? [],
        outcome: r.outcome ?? null,
        sourceIds,
        lockedFields: [],
    };
}

/** 활동 하나의 폼을 채우고 validateEntry 를 통과시킨다(1회 재시도 후 위반 문장 삭제). */
async function composeEntry(
    activityId: string,
    activityEvidence: Evidence[],
    deps: Deps,
): Promise<ActivityEntry> {
    const allowed = new Set(activityEvidence.map((e) => e.id));
    const sourceIds = [...new Set(activityEvidence.map((e) => e.quoteRef.artifactId))];

    const call = (violations?: string[]): BedrockToolCall<EntryToolResult> => ({
        prompt: buildPrompt(activityEvidence, violations),
        toolName: 'fill_activity',
        schema: ENTRY_SCHEMA,
    });

    let entry = toEntry(activityId, sourceIds, await deps.bedrock.invokeTool(call()));
    let violations = validateEntry(entry, allowed);
    if (violations.length > 0) {
        // 위반 내용을 붙여 1회만 재시도
        entry = toEntry(activityId, sourceIds, await deps.bedrock.invokeTool(call(violations)));
        violations = validateEntry(entry, allowed);
        if (violations.length > 0) {
            // 그래도 실패한 문장은 삭제
            entry = stripInvalidSentences(entry, allowed);
        }
    }
    return entry;
}

/** 기간 정렬 키(없으면 맨 뒤). */
function periodKey(entry: ActivityEntry): string {
    return entry.period?.start ?? '9999-99';
}

/**
 * 활동별로 폼을 채워 MasterOutput 을 만든다. entries 는 period.start 기준 정렬.
 */
export async function composeMaster(
    portfolioId: string,
    consolidated: Evidence[],
    deps: Deps,
): Promise<MasterOutput> {
    // activityId 별로 Evidence 를 모은다
    const byActivity = new Map<string, Evidence[]>();
    for (const e of consolidated) {
        const aid = e.activityId;
        if (!aid) continue;
        const arr = byActivity.get(aid) ?? [];
        arr.push(e);
        byActivity.set(aid, arr);
    }

    const entries: ActivityEntry[] = [];
    for (const [activityId, evs] of byActivity) {
        entries.push(await composeEntry(activityId, evs, deps));
    }

    entries.sort((a, b) => periodKey(a).localeCompare(periodKey(b)));

    return {
        kind: 'master',
        portfolioId,
        entries,
        generatedAt: deps.clock.now(),
    };
}
