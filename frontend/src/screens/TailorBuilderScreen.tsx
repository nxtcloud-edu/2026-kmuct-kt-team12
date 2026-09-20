// src/screens/TailorBuilderScreen.tsx
// 화면 4: 직무 맞춤 만들기. 직무명/JD 입력, 활동 체크리스트(AI 추천 체크 반영), 만들기.
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { MasterOutput } from '@shared/types';
import { api } from '../api';

export function TailorBuilderScreen() {
    const { id = 'pf-demo' } = useParams();
    const navigate = useNavigate();
    const [master, setMaster] = useState<MasterOutput | null>(null);
    const [role, setRole] = useState('');
    const [jd, setJd] = useState('');
    const [checked, setChecked] = useState<Record<string, boolean>>({});
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        (async () => {
            const view = await api.getPortfolio(id);
            setMaster(view.master);
            // AI 추천 체크 대용: 기본 전체 체크(실제는 rankActivities 결과 반영)
            const init: Record<string, boolean> = {};
            view.master?.entries.forEach((e) => (init[e.activityId] = true));
            setChecked(init);
        })();
    }, [id]);

    async function make() {
        const activityIds = Object.entries(checked)
            .filter(([, v]) => v)
            .map(([k]) => k);
        if (!role.trim() || activityIds.length === 0) return;
        setBusy(true);
        // 목: createOutput 은 outputId 를 즉시 반환(데모). 실제는 202 runId → 폴링 후 이동.
        const outputId = await api.createOutput(id, { targetRole: role.trim(), jdText: jd.trim() || undefined, activityIds });
        navigate(`/p/${id}/o/${outputId}`);
    }

    if (!master) return <div className="container">불러오는 중…</div>;

    return (
        <div className="container">
            <h2>직무 맞춤 만들기</h2>
            <div className="linkform">
                <input placeholder="희망 직무 (예: 백엔드 개발자)" value={role} onChange={(e) => setRole(e.target.value)} />
            </div>
            <textarea placeholder="채용공고(JD)를 붙여넣으면 더 정확해집니다 (선택)" value={jd} onChange={(e) => setJd(e.target.value)} />

            <div className="field-label" style={{ marginTop: 16 }}>
                넣을 활동 선택
            </div>
            <ul className="checklist">
                {master.entries.map((e) => (
                    <li key={e.activityId}>
                        <input
                            type="checkbox"
                            checked={!!checked[e.activityId]}
                            onChange={(ev) => setChecked((c) => ({ ...c, [e.activityId]: ev.target.checked }))}
                        />
                        <span>
                            <strong>{e.title.text}</strong>
                            <br />
                            <span className="muted">{e.summary.text}</span>
                        </span>
                    </li>
                ))}
            </ul>

            <div className="btn-row">
                <button className="btn btn-primary" onClick={make} disabled={busy || !role.trim()}>
                    만들기
                </button>
                <button className="btn" onClick={() => navigate(`/p/${id}`)}>
                    취소
                </button>
            </div>
        </div>
    );
}
