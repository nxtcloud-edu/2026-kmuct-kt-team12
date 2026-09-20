// src/components/TimelineCard.tsx
// 활동 카드. 제목(키워드)을 누르면 펼쳐져 상세(무엇/어떻게/결과 + 기술)를 보여준다.
// 각 문장은 SentenceView 라 클릭 시 원문 구절까지 추적된다. null 칸은 회색, 추정 기간은 꼬리표.
// editable=true 면 요약·성과를 직접 수정할 수 있고, 저장 시 그 칸이 잠긴다(lockedFields).
import { useState } from 'react';
import type { ActivityEntry, Sentence } from '@shared/types';
import { SentenceView } from '../evidence/SentenceView';

const TYPE_LABEL: Record<ActivityEntry['type'], string> = {
    project: '프로젝트',
    club: '동아리',
    contest: '공모전',
    intern: '인턴',
    study: '스터디',
    etc: '기타',
};

function periodText(entry: ActivityEntry): string {
    if (!entry.period) return '';
    const { start, end } = entry.period;
    if (!start && !end) return '';
    return `${start ?? '?'}${end ? ` ~ ${end}` : ' ~'}`;
}

function SentenceList({ label, items }: { label: string; items: Sentence[] }) {
    if (items.length === 0) {
        return (
            <div className="field">
                <div className="field-label">{label}</div>
                <div className="field-empty">내용 없음</div>
            </div>
        );
    }
    return (
        <div className="field">
            <div className="field-label">{label}</div>
            <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                {items.map((s, i) => (
                    <li key={i}>
                        <SentenceView sentence={s} />
                    </li>
                ))}
            </ul>
        </div>
    );
}

export interface TimelineCardProps {
    entry: ActivityEntry;
    defaultOpen?: boolean;
    /** 있으면 요약·성과 직접 수정 가능. field 는 'summary' | 'outcome'. */
    onEdit?: (activityId: string, field: string, text: string) => Promise<void>;
}

function LockBadge() {
    return <span className="tag-inferred" title="직접 수정해 잠긴 칸입니다">🔒 잠김</span>;
}

export function TimelineCard({ entry, defaultOpen = false, onEdit }: TimelineCardProps) {
    const [open, setOpen] = useState(defaultOpen);
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const period = periodText(entry);
    const locked = new Set(entry.lockedFields);

    async function save(field: string) {
        if (onEdit) await onEdit(entry.activityId, field, draft);
        setEditing(null);
    }

    function startEdit(field: string, current: string) {
        setEditing(field);
        setDraft(current);
    }

    return (
        <div className="tl-card" onClick={() => setOpen((v) => !v)}>
            <div className="tl-type">{TYPE_LABEL[entry.type]}</div>
            <h3 className="tl-title">
                <SentenceView sentence={entry.title} />
            </h3>
            {period && (
                <div className="tl-period">
                    {period}
                    {entry.period?.inferred && <span className="tag-inferred">추정</span>}
                </div>
            )}

            {open && (
                <div onClick={(e) => e.stopPropagation()}>
                    <div className="field">
                        <div className="field-label">
                            요약 {locked.has('summary') && <LockBadge />}
                            {onEdit && editing !== 'summary' && (
                                <button className="btn" style={{ marginLeft: 8, padding: '2px 8px', fontSize: 12 }} onClick={() => startEdit('summary', entry.summary.text)}>
                                    수정
                                </button>
                            )}
                        </div>
                        {editing === 'summary' ? (
                            <div>
                                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} style={{ minHeight: 60 }} />
                                <div className="btn-row" style={{ margin: '6px 0' }}>
                                    <button className="btn btn-primary" onClick={() => save('summary')}>
                                        저장(칸 잠금)
                                    </button>
                                    <button className="btn" onClick={() => setEditing(null)}>
                                        취소
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <SentenceView sentence={entry.summary} />
                        )}
                    </div>

                    {entry.affiliationRole ? (
                        <div className="field">
                            <div className="field-label">소속·역할</div>
                            <SentenceView sentence={entry.affiliationRole} />
                        </div>
                    ) : null}

                    <SentenceList label="무엇을" items={entry.what} />
                    <SentenceList label="어떻게" items={entry.how} />
                    <SentenceList label="결과" items={entry.result} />

                    <div className="field">
                        <div className="field-label">기술</div>
                        {entry.tech.length ? (
                            <div className="tech-chips">
                                {entry.tech.map((t) => (
                                    <span key={t} className="chip">
                                        {t}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <div className="field-empty">기술 미입력</div>
                        )}
                    </div>

                    <div className="field">
                        <div className="field-label">
                            성과 {locked.has('outcome') && <LockBadge />}
                            {onEdit && editing !== 'outcome' && (
                                <button className="btn" style={{ marginLeft: 8, padding: '2px 8px', fontSize: 12 }} onClick={() => startEdit('outcome', entry.outcome?.[0]?.text ?? '')}>
                                    수정
                                </button>
                            )}
                        </div>
                        {editing === 'outcome' ? (
                            <div>
                                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} style={{ minHeight: 60 }} placeholder="성과를 입력하면 회색 칸이 채워집니다" />
                                <div className="btn-row" style={{ margin: '6px 0' }}>
                                    <button className="btn btn-primary" onClick={() => save('outcome')}>
                                        저장(칸 잠금)
                                    </button>
                                    <button className="btn" onClick={() => setEditing(null)}>
                                        취소
                                    </button>
                                </div>
                            </div>
                        ) : entry.outcome && entry.outcome.length ? (
                            entry.outcome.map((s, i) => <SentenceView key={i} sentence={s} />)
                        ) : (
                            <div className="field-empty">성과 미입력</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
