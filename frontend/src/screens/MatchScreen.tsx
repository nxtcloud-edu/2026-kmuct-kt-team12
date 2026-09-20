// src/screens/MatchScreen.tsx
// 경험 매칭 챗봇 화면. AI가 생성한 질문에 사용자가 "네"/"아니오"로 답하고 세부사항을 입력한다.
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { MatchSession, MatchQuestion } from '@shared/types';
import { api } from '../api';

function QuestionItem({
    q,
    onAnswer,
}: {
    q: MatchQuestion;
    onAnswer: (questionId: string, confirmed: boolean, answer?: string) => void;
}) {
    const [detail, setDetail] = useState('');
    const [submitting, setSubmitting] = useState(false);

    if (q.status === 'confirmed') {
        return (
            <li className="match-item match-confirmed">
                <div className="match-question">{q.question}</div>
                <div className="match-answer">
                    <span className="match-badge confirmed">확인됨</span>
                    {q.userAnswer && <span className="match-detail">{q.userAnswer}</span>}
                </div>
            </li>
        );
    }
    if (q.status === 'denied') {
        return (
            <li className="match-item match-denied">
                <div className="match-question">{q.question}</div>
                <div className="match-answer">
                    <span className="match-badge denied">해당 없음</span>
                </div>
            </li>
        );
    }

    // pending 상태
    async function handleConfirm() {
        setSubmitting(true);
        await onAnswer(q.id, true, detail.trim() || undefined);
        setSubmitting(false);
    }
    async function handleDeny() {
        setSubmitting(true);
        await onAnswer(q.id, false);
        setSubmitting(false);
    }

    return (
        <li className="match-item">
            <div className="match-question">{q.question}</div>
            <div className="match-keyword">
                <span className="chip">{q.suggestedKeyword}</span>
            </div>
            <input
                className="match-input"
                placeholder="세부 내용을 입력하세요 (선택)"
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                disabled={submitting}
            />
            <div className="btn-row">
                <button className="btn btn-primary" onClick={handleConfirm} disabled={submitting}>
                    네
                </button>
                <button className="btn" onClick={handleDeny} disabled={submitting}>
                    아니오
                </button>
            </div>
        </li>
    );
}

export function MatchScreen() {
    const { id = 'pf-demo' } = useParams();
    const navigate = useNavigate();
    const [session, setSession] = useState<MatchSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [sessionId, setSessionId] = useState<string | null>(null);

    // 세션 시작
    useEffect(() => {
        (async () => {
            setLoading(true);
            const sid = await api.startMatch(id);
            setSessionId(sid);
            const s = await api.getMatch(id, sid);
            setSession(s);
            setLoading(false);
        })();
    }, [id]);

    async function handleAnswer(questionId: string, confirmed: boolean, answer?: string) {
        if (!sessionId) return;
        const updated = await api.answerMatch(id, sessionId, questionId, confirmed, answer);
        setSession(updated);
    }

    if (loading) return <div className="container">질문을 생성하는 중...</div>;
    if (!session) return <div className="container">세션을 불러올 수 없습니다.</div>;

    const pending = session.questions.filter((q) => q.status === 'pending');
    const answered = session.questions.filter((q) => q.status !== 'pending');
    const confirmedCount = session.questions.filter((q) => q.status === 'confirmed').length;

    return (
        <div className="container">
            <h2>경험 매칭</h2>
            <p className="muted">
                AI가 활동에서 추가 경험을 추론했습니다. 해당하는 경험에 "네"를 누르고 세부 내용을 적어주세요.
            </p>

            {session.status === 'done' && (
                <div className="banner">
                    <span>매칭 완료! {confirmedCount}개의 경험이 확인되었습니다.</span>
                    <button className="btn" onClick={() => navigate(`/p/${id}`)}>
                        타임라인으로 돌아가기
                    </button>
                </div>
            )}

            <ul className="match-list">
                {/* 아직 답변하지 않은 질문을 먼저 보여준다 */}
                {pending.map((q) => (
                    <QuestionItem key={q.id} q={q} onAnswer={handleAnswer} />
                ))}
                {/* 답변 완료된 질문 */}
                {answered.map((q) => (
                    <QuestionItem key={q.id} q={q} onAnswer={handleAnswer} />
                ))}
            </ul>

            <div className="btn-row">
                <button className="btn" onClick={() => navigate(`/p/${id}`)}>
                    {session.status === 'done' ? '타임라인으로' : '나중에 하기'}
                </button>
            </div>
        </div>
    );
}
