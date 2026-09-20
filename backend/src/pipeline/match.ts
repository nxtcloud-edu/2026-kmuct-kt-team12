// backend/src/pipeline/match.ts
// 경험 매칭: 마스터 타임라인의 활동을 분석해 사용자에게 추가 경험 질문을 생성한다.
// AI가 각 활동의 기술 스택과 what/how/result를 보고, 관련되지만 명시되지 않은 경험을 추론한다.

import type { Deps, BedrockToolCall } from '../ports.js';
import type { MasterOutput, MatchQuestion, MatchSession } from '../../../shared/types.js';

/** AI tool 이 반환하는 질문 목록 */
export interface MatchToolResult {
    questions: Array<{
        activityId: string;
        suggestedKeyword: string;
        question: string;
    }>;
}

const MATCH_SCHEMA = {
    type: 'object',
    properties: {
        questions: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    activityId: { type: 'string' },
                    suggestedKeyword: { type: 'string' },
                    question: { type: 'string' },
                },
                required: ['activityId', 'suggestedKeyword', 'question'],
            },
        },
    },
    required: ['questions'],
};

function buildMatchPrompt(master: MasterOutput): string {
    const lines: string[] = [
        '아래는 사용자의 활동 목록이다. 각 활동의 기술 스택, 무엇을 했는지(what), 어떻게 했는지(how), 결과(result)를 보고,',
        '관련되지만 명시되지 않은 경험을 추론하여 질문을 만들어라.',
        '',
        '규칙:',
        '- 각 활동당 2~3개의 질문을 만들어라.',
        '- 질문은 한국어로, 짧고 직접적으로 작성하라.',
        '- suggestedKeyword 는 그 경험을 한 단어/구로 요약한 것이다 (예: "Database 설계", "CI/CD 구축").',
        '- 이미 명시된 내용을 다시 묻지 마라. 명시되지 않았지만 해당 활동에서 흔히 수반되는 경험만 질문하라.',
        '- activityId 는 반드시 아래 목록에 있는 id 를 사용하라.',
        '',
    ];

    for (const entry of master.entries) {
        lines.push(`--- 활동: ${entry.title.text} (id: ${entry.activityId}) ---`);
        lines.push(`유형: ${entry.type}`);
        lines.push(`기술: ${entry.tech.length > 0 ? entry.tech.join(', ') : '(없음)'}`);
        lines.push(`무엇: ${entry.what.map((s) => s.text).join('; ') || '(없음)'}`);
        lines.push(`어떻게: ${entry.how.map((s) => s.text).join('; ') || '(없음)'}`);
        lines.push(`결과: ${entry.result.map((s) => s.text).join('; ') || '(없음)'}`);
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * 마스터 타임라인 활동들을 분석해 경험 매칭 질문을 생성한다.
 */
export async function generateMatchQuestions(
    master: MasterOutput,
    deps: Deps,
): Promise<MatchQuestion[]> {
    const call: BedrockToolCall<MatchToolResult> = {
        prompt: buildMatchPrompt(master),
        toolName: 'generate_match_questions',
        schema: MATCH_SCHEMA,
    };

    const result = await deps.bedrock.invokeTool(call);

    // 유효한 activityId 집합
    const validIds = new Set(master.entries.map((e) => e.activityId));

    return result.questions
        .filter((q) => validIds.has(q.activityId))
        .map((q) => ({
            id: deps.id.next('mq'),
            activityId: q.activityId,
            question: q.question,
            suggestedKeyword: q.suggestedKeyword,
            status: 'pending' as const,
        }));
}

/** 매칭 세션을 시작한다(질문 생성 + 저장). */
export async function startMatchSession(
    portfolioId: string,
    master: MasterOutput,
    deps: Deps,
): Promise<MatchSession> {
    const questions = await generateMatchQuestions(master, deps);
    const session: MatchSession = {
        id: deps.id.next('ms'),
        portfolioId,
        questions,
        status: 'active',
        createdAt: deps.clock.now(),
    };
    await deps.store.putMatchSession(session);
    return session;
}

/** 질문에 답변한다. 확인 시 userAnswer 저장, 전부 답변되면 세션 종료. */
export async function answerQuestion(
    session: MatchSession,
    questionId: string,
    confirmed: boolean,
    answer: string | undefined,
    deps: Deps,
): Promise<MatchSession> {
    const updated = structuredClone(session);
    const q = updated.questions.find((x) => x.id === questionId);
    if (!q) throw new Error(`질문을 찾을 수 없다: ${questionId}`);
    q.status = confirmed ? 'confirmed' : 'denied';
    if (confirmed && answer) q.userAnswer = answer;

    if (updated.questions.every((x) => x.status !== 'pending')) {
        updated.status = 'done';
    }
    await deps.store.putMatchSession(updated);
    return updated;
}
