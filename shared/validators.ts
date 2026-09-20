// shared/validators.ts
// docs/design.md 프롬프트 2가 지정한 검증 함수 3개.
// 환각 방지는 프롬프트가 아니라 이 코드가 강제한다.

import type {
    Artifact,
    QuoteRef,
    ActivityEntry,
    Sentence,
    TailoredOutput,
} from './types';

/**
 * 공백류(스페이스, 탭, 줄바꿈 등)를 하나의 스페이스로 접고 양끝을 다듬는다.
 * 반환하는 map[i]는 정규화 문자열의 i번째 문자가 원문에서 시작하는 인덱스다.
 * map[normalized.length]는 원문에서의 소비 끝 위치(마지막 유효 문자 다음)를 담는다.
 */
function normalizeWithMap(raw: string): { text: string; map: number[] } {
    const out: string[] = [];
    const map: number[] = [];
    let i = 0;
    const n = raw.length;

    // 앞쪽 공백 건너뛰기
    while (i < n && /\s/.test(raw[i])) i++;

    while (i < n) {
        const ch = raw[i];
        if (/\s/.test(ch)) {
            // 연속 공백을 하나로 접는다
            let j = i;
            while (j < n && /\s/.test(raw[j])) j++;
            if (j < n) {
                // 뒤에 비공백이 남아 있을 때만 스페이스 하나를 넣는다 (끝쪽 공백은 버림)
                out.push(' ');
                map.push(i); // 접힌 공백 구간의 시작 인덱스
            }
            i = j;
        } else {
            out.push(ch);
            map.push(i);
            i++;
        }
    }
    // 끝 경계: 마지막으로 소비한 원문 위치 다음
    map.push(i);
    return { text: out.join(''), map };
}

/**
 * rawText에 quote가 (공백 정규화 기준) 부분 문자열로 있으면
 * 원문 기준 start, end를 계산해 QuoteRef를 반환한다. 없으면 null.
 */
export function verifyQuote(artifact: Artifact, quote: string): QuoteRef | null {
    const raw = artifact.rawText;

    // 1) 빠른 경로: 원문 그대로 부분 문자열이면 그대로 위치 반환
    const direct = raw.indexOf(quote);
    if (direct !== -1) {
        return {
            artifactId: artifact.id,
            quote,
            start: direct,
            end: direct + quote.length,
        };
    }

    // 2) 공백 정규화 후 비교
    const { text: normRaw, map } = normalizeWithMap(raw);
    const { text: normQuote } = normalizeWithMap(quote);
    if (normQuote.length === 0) return null;

    const pos = normRaw.indexOf(normQuote);
    if (pos === -1) return null;

    const start = map[pos];
    // 정규화 인용의 끝 문자가 원문에서 차지하는 위치 + 그 문자 길이(1)
    const lastNormIdx = pos + normQuote.length - 1;
    const end = map[lastNormIdx] + 1;

    return {
        artifactId: artifact.id,
        quote, // 원문 인용 문자열은 호출자가 준 그대로 보존
        start,
        end,
    };
}

/** Sentence 하나의 evidenceIds가 1개 이상이고 전부 집합 안에 있는지 검사한다. */
function checkSentence(
    label: string,
    s: Sentence,
    evidenceIds: Set<string>,
    violations: string[],
): void {
    if (!s.evidenceIds || s.evidenceIds.length === 0) {
        violations.push(`${label}: evidenceIds 가 비어 있음 ("${s.text}")`);
        return;
    }
    for (const id of s.evidenceIds) {
        if (!evidenceIds.has(id)) {
            violations.push(`${label}: 알 수 없는 evidenceId "${id}" ("${s.text}")`);
        }
    }
}

/**
 * ActivityEntry의 모든 Sentence가 evidenceIds를 1개 이상 갖고,
 * 그 id들이 전부 evidenceIds 집합 안에 있는지 검사한다.
 * 위반 목록을 문자열 배열로 반환한다(문제 없으면 빈 배열).
 */
export function validateEntry(
    entry: ActivityEntry,
    evidenceIds: Set<string>,
): string[] {
    const v: string[] = [];
    const id = entry.activityId;

    checkSentence(`${id}.title`, entry.title, evidenceIds, v);
    checkSentence(`${id}.summary`, entry.summary, evidenceIds, v);

    if (entry.affiliationRole) {
        checkSentence(`${id}.affiliationRole`, entry.affiliationRole, evidenceIds, v);
    }

    entry.what.forEach((s, i) => checkSentence(`${id}.what[${i}]`, s, evidenceIds, v));
    entry.how.forEach((s, i) => checkSentence(`${id}.how[${i}]`, s, evidenceIds, v));
    entry.result.forEach((s, i) => checkSentence(`${id}.result[${i}]`, s, evidenceIds, v));

    if (entry.outcome) {
        entry.outcome.forEach((s, i) => checkSentence(`${id}.outcome[${i}]`, s, evidenceIds, v));
    }

    // period.evidenceIds 는 Sentence 가 아니지만 집합 소속은 검사한다(있을 때)
    if (entry.period) {
        for (const eid of entry.period.evidenceIds) {
            if (!evidenceIds.has(eid)) {
                v.push(`${id}.period: 알 수 없는 evidenceId "${eid}"`);
            }
        }
    }

    return v;
}

/**
 * TailoredOutput의 intro와 entries의 모든 evidenceIds가
 * 선택된 활동의 근거 집합(allowedEvidenceIds) 안에 있는지 검사한다.
 * 위반 목록을 문자열 배열로 반환한다(문제 없으면 빈 배열).
 */
export function validateTailored(
    output: TailoredOutput,
    allowedEvidenceIds: Set<string>,
): string[] {
    const v: string[] = [];

    output.intro.forEach((s, i) => checkSentence(`intro[${i}]`, s, allowedEvidenceIds, v));

    output.entries.forEach((entry) => {
        v.push(...validateEntry(entry, allowedEvidenceIds));
    });

    // competencies 의 evidenceIds 도 허용 집합 안에 있어야 한다(비어 있는 것은 공백 리포트용이라 허용)
    output.competencies.forEach((c) => {
        for (const eid of c.evidenceIds) {
            if (!allowedEvidenceIds.has(eid)) {
                v.push(`competency "${c.name}": 알 수 없는 evidenceId "${eid}"`);
            }
        }
    });

    return v;
}
