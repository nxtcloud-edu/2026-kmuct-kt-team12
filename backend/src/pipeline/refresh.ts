// backend/src/pipeline/refresh.ts
// 갱신(refresh): contentHash 가 바뀐 Artifact 만 2단계를 다시 돌린다.
// 3·4단계는 전체를 다시 돌리되, lockedFields 에 있는 칸은 기존(마스터) 값을 유지한다.

import type { ActivityEntry, Artifact, MasterOutput, Sentence, Period } from '../../../shared/types.js';

/** 저장된 이전 Artifact 와 새로 수집한 Artifact 를 비교해 contentHash 가 바뀐 sourceId 집합을 낸다. */
export function changedSourceIds(previous: Artifact[], current: Artifact[]): Set<string> {
    const prevBySource = new Map(previous.map((a) => [a.sourceId, a.contentHash]));
    const changed = new Set<string>();
    for (const cur of current) {
        const prevHash = prevBySource.get(cur.sourceId);
        if (prevHash === undefined || prevHash !== cur.contentHash) {
            changed.add(cur.sourceId);
        }
    }
    return changed;
}

type EntryFieldKey = keyof Pick<
    ActivityEntry,
    'title' | 'period' | 'affiliationRole' | 'summary' | 'what' | 'how' | 'result' | 'tech' | 'outcome'
>;

/**
 * 새로 작성한 entry 에서, 이전 entry 의 lockedFields 에 해당하는 칸을 이전 값으로 되돌린다.
 * activityId 로 이전 entry 를 찾는다. 없으면 새 entry 를 그대로 둔다.
 */
export function preserveLockedFields(
    newEntry: ActivityEntry,
    previousMaster: MasterOutput | null,
): ActivityEntry {
    const prev = previousMaster?.entries.find((e) => e.activityId === newEntry.activityId);
    if (!prev || prev.lockedFields.length === 0) return newEntry;

    const merged: ActivityEntry = { ...newEntry, lockedFields: [...prev.lockedFields] };
    const mergedRec = merged as unknown as Record<string, unknown>;
    const prevRec = prev as unknown as Record<string, unknown>;
    for (const field of prev.lockedFields as EntryFieldKey[]) {
        if (field in prev) {
            // 이전 값(사용자가 직접 고친 칸)을 유지
            mergedRec[field] = prevRec[field];
        }
    }
    return merged;
}

/** 갱신 시 전체 마스터에 대해 lockedFields 보존을 적용한다. */
export function applyLockedFields(
    newMaster: MasterOutput,
    previousMaster: MasterOutput | null,
): MasterOutput {
    return {
        ...newMaster,
        entries: newMaster.entries.map((e) => preserveLockedFields(e, previousMaster)),
    };
}
