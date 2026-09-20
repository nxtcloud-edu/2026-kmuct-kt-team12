// src/evidence/EvidencePanel.tsx
// 열린 evidenceIds 에 대해 원문 구절(QuoteRef)을 보여준다. 문장이 어느 출처의 어느 구절에서 왔는지 추적.
import { useEvidence } from './EvidenceContext';

function kindLabel(url?: string): string {
    if (!url) return '파일';
    if (url.includes('github.com')) return '깃허브';
    if (url.includes('notion')) return '노션';
    return '웹';
}

export function EvidencePanel() {
    const { activeIds, close, evidenceById, artifactById } = useEvidence();
    if (!activeIds) return null;

    const items = activeIds
        .map((id) => evidenceById.get(id))
        .filter((e): e is NonNullable<typeof e> => !!e);

    return (
        <aside className="evidence-panel" aria-label="근거 패널">
            <button className="btn evidence-close" onClick={close}>
                닫기
            </button>
            <h3>원문 근거</h3>
            {items.length === 0 && <p className="muted">연결된 근거가 없습니다.</p>}
            {items.map((e) => {
                const art = artifactById.get(e.quoteRef.artifactId);
                const title = art?.meta.title ?? e.quoteRef.artifactId;
                return (
                    <div key={e.id}>
                        <p className="muted" style={{ marginBottom: 4 }}>
                            {e.claim}
                        </p>
                        <div className="quote-block">{e.quoteRef.quote}</div>
                        <p className="quote-src">
                            출처: {kindLabel(art && 'url' in art ? undefined : undefined)} {title}
                            {' · '}
                            {e.field}
                        </p>
                    </div>
                );
            })}
        </aside>
    );
}
