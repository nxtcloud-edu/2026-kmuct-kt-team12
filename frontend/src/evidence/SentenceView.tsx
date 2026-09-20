// src/evidence/SentenceView.tsx
// 문장을 렌더하고, 클릭하면 그 evidenceIds 로 근거 패널을 연다.
import type { Sentence } from '@shared/types';
import { useEvidence } from './EvidenceContext';

export function SentenceView({ sentence }: { sentence: Sentence }) {
    const { open, activeIds } = useEvidence();
    const isActive =
        !!activeIds && sentence.evidenceIds.length > 0 && sentence.evidenceIds.every((id) => activeIds.includes(id));
    return (
        <span
            className={`sentence${isActive ? ' active' : ''}`}
            role="button"
            tabIndex={0}
            title="클릭하면 원문 근거를 봅니다"
            onClick={() => open(sentence.evidenceIds)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') open(sentence.evidenceIds);
            }}
        >
            {sentence.text}
        </span>
    );
}
