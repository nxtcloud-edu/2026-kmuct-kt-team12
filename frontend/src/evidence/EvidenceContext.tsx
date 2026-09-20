// src/evidence/EvidenceContext.tsx
// 근거 추적 상태. 문장 클릭 시 evidenceIds 를 열고, evidence/artifact 로 원문 구절을 찾는다.
import { createContext, useContext, useState, useMemo, type ReactNode } from 'react';
import type { Evidence, Artifact } from '@shared/types';

interface EvidenceCtx {
    open: (evidenceIds: string[]) => void;
    close: () => void;
    activeIds: string[] | null;
    evidenceById: Map<string, Evidence>;
    artifactById: Map<string, Artifact>;
}

const Ctx = createContext<EvidenceCtx | null>(null);

export function EvidenceProvider({
    evidence,
    artifacts,
    children,
}: {
    evidence: Evidence[];
    artifacts: Artifact[];
    children: ReactNode;
}) {
    const [activeIds, setActiveIds] = useState<string[] | null>(null);
    const value = useMemo<EvidenceCtx>(
        () => ({
            open: (ids) => setActiveIds(ids),
            close: () => setActiveIds(null),
            activeIds,
            evidenceById: new Map(evidence.map((e) => [e.id, e])),
            artifactById: new Map(artifacts.map((a) => [a.id, a])),
        }),
        [activeIds, evidence, artifacts],
    );
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEvidence(): EvidenceCtx {
    const c = useContext(Ctx);
    if (!c) throw new Error('EvidenceProvider 안에서만 useEvidence 사용');
    return c;
}
