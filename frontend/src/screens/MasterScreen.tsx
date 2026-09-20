// src/screens/MasterScreen.tsx
// 화면 3: 마스터 타임라인. 세로 시간순 활동 카드, 제목(키워드) 클릭 진입, 문장 클릭 원문 추적.
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { MasterOutput, Evidence, Artifact } from '@shared/types';
import { api } from '../api';
import { EvidenceProvider } from '../evidence/EvidenceContext';
import { EvidencePanel } from '../evidence/EvidencePanel';
import { TimelineCard } from '../components/TimelineCard';

export function MasterScreen() {
    const { id = 'pf-demo' } = useParams();
    const navigate = useNavigate();
    const [master, setMaster] = useState<MasterOutput | null>(null);
    const [evidence, setEvidence] = useState<Evidence[]>([]);
    const [artifacts, setArtifacts] = useState<Artifact[]>([]);
    const [refreshing, setRefreshing] = useState(false);

    async function load() {
        const [view, arts] = await Promise.all([api.getPortfolio(id), api.getArtifacts(id)]);
        setMaster(view.master);
        setEvidence(view.evidence);
        setArtifacts(arts);
    }
    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    async function onRefresh() {
        setRefreshing(true);
        await api.startRun(id, 'refresh');
        await load();
        setRefreshing(false);
    }

    // 직접 수정: 해당 칸을 사용자 문장으로 바꾸고 그 칸을 잠근다(lockedFields).
    // 사용자가 직접 쓴 내용은 근거가 없을 수 있으므로 evidenceIds 는 기존 값을 유지한다.
    async function onEdit(activityId: string, field: string, text: string) {
        if (!master) return;
        const entry = master.entries.find((e) => e.activityId === activityId);
        if (!entry) return;
        let patch: Record<string, unknown>;
        if (field === 'summary') {
            patch = { summary: { text, evidenceIds: entry.summary.evidenceIds }, lockedFields: ['summary'] };
        } else {
            // outcome: 문장 배열. 기존 근거가 없으면 빈 배열(사용자 직접 입력)
            const ev = entry.outcome?.[0]?.evidenceIds ?? [];
            patch = { outcome: [{ text, evidenceIds: ev }], lockedFields: ['outcome'] };
        }
        await api.patchEntry(id, activityId, patch);
        await load();
    }

    if (!master) return <div className="container">불러오는 중…</div>;

    return (
        <EvidenceProvider evidence={evidence} artifacts={artifacts}>
            <div className="container">
                <h2>마스터 타임라인</h2>
                <p className="muted">시간순으로 정리된 활동입니다. 제목을 누르면 상세가, 문장을 누르면 원문 근거가 열립니다.</p>
                <div className="btn-row">
                    <button className="btn" onClick={onRefresh} disabled={refreshing}>
                        {refreshing ? '갱신 중…' : '다시 불러오기'}
                    </button>
                    <button className="btn" onClick={() => navigate(`/p/${id}/match`)}>
                        경험 매칭하기
                    </button>
                    <button className="btn btn-primary" onClick={() => navigate(`/p/${id}/tailor`)}>
                        직무 맞춤 만들기
                    </button>
                </div>
                <div className="timeline">
                    {master.entries.map((entry) => (
                        <TimelineCard key={entry.activityId} entry={entry} onEdit={onEdit} />
                    ))}
                </div>
            </div>
            <EvidencePanel />
        </EvidenceProvider>
    );
}
