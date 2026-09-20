// src/screens/TailoredScreen.tsx
// 화면 5: 맞춤 포트폴리오. 상단 자기소개, 역량 태그, 공백 리포트, 관련도순 활동, PDF 내보내기.
// 마스터가 더 새로우면 "원본이 바뀜" 배너.
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { TailoredOutput, Evidence, Artifact, MasterOutput } from '@shared/types';
import { api } from '../api';
import { EvidenceProvider } from '../evidence/EvidenceContext';
import { EvidencePanel } from '../evidence/EvidencePanel';
import { SentenceView } from '../evidence/SentenceView';
import { TimelineCard } from '../components/TimelineCard';

export function TailoredScreen() {
    const { id = 'pf-demo', outputId = '' } = useParams();
    const navigate = useNavigate();
    const [output, setOutput] = useState<TailoredOutput | null>(null);
    const [evidence, setEvidence] = useState<Evidence[]>([]);
    const [artifacts, setArtifacts] = useState<Artifact[]>([]);
    const [master, setMaster] = useState<MasterOutput | null>(null);
    const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
    const [publishing, setPublishing] = useState(false);

    useEffect(() => {
        (async () => {
            const [out, view, arts] = await Promise.all([
                api.getOutput(outputId),
                api.getPortfolio(id),
                api.getArtifacts(id),
            ]);
            setOutput(out);
            setEvidence(view.evidence);
            setArtifacts(arts);
            setMaster(view.master);
        })();
    }, [id, outputId]);

    const handlePublish = async () => {
        if (!output) return;
        setPublishing(true);
        try {
            const { url } = await api.publishOutput(id, output.id);
            setPublishedUrl(url);
        } catch (e) {
            alert('발행 실패: ' + (e as Error).message);
        } finally {
            setPublishing(false);
        }
    };

    const handleCopyUrl = () => {
        if (publishedUrl) {
            navigator.clipboard.writeText(publishedUrl).catch(() => {});
        }
    };

    if (!output) return <div className="container">불러오는 중…</div>;

    const stale = master ? master.generatedAt > output.basedOnMasterAt : false;
    const gaps = output.competencies.filter((c) => c.evidenceIds.length === 0);

    return (
        <EvidenceProvider evidence={evidence} artifacts={artifacts}>
            <div className="container">
                {stale && (
                    <div className="banner">
                        <span>원본이 바뀌었습니다. 맞춤본을 다시 만들 수 있습니다.</span>
                        <button className="btn" onClick={() => navigate(`/p/${id}/tailor`)}>
                            다시 만들기
                        </button>
                    </div>
                )}

                <h2>{output.targetRole} 맞춤 포트폴리오</h2>
                <div className="btn-row">
                    <button className="btn btn-primary" onClick={() => window.print()}>
                        PDF로 내보내기
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handlePublish}
                        disabled={publishing}
                    >
                        {publishing ? '발행 중…' : '웹사이트로 발행'}
                    </button>
                    <button className="btn" onClick={() => navigate(`/p/${id}`)}>
                        마스터로
                    </button>
                </div>

                {publishedUrl && (
                    <div className="banner" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' }}>
                        <span style={{ wordBreak: 'break-all', fontSize: '13px' }}>
                            이 URL로 포트폴리오를 공유할 수 있습니다: {publishedUrl}
                        </span>
                        <button className="btn" onClick={handleCopyUrl} style={{ flexShrink: 0 }}>
                            복사
                        </button>
                    </div>
                )}

                <section>
                    <div className="field-label">자기소개</div>
                    {output.intro.map((s, i) => (
                        <p key={i} style={{ margin: '4px 0' }}>
                            <SentenceView sentence={s} />
                        </p>
                    ))}
                </section>

                <section>
                    <div className="field-label">역량</div>
                    <div className="competency-tags">
                        {output.competencies.map((c) => (
                            <span key={c.name} className={`competency${c.evidenceIds.length === 0 ? ' gap' : ''}`}>
                                {c.name}
                            </span>
                        ))}
                    </div>
                </section>

                {gaps.length > 0 && (
                    <div className="gap-report">
                        <div className="field-label">공백 리포트</div>
                        {gaps.map((c) => (
                            <div key={c.name} className="gap-item">
                                · {c.name}: 근거 없음
                            </div>
                        ))}
                    </div>
                )}

                <section>
                    <div className="field-label">관련 활동 (관련도순)</div>
                    <div className="timeline">
                        {output.entries.map((entry) => (
                            <TimelineCard key={entry.activityId} entry={entry} defaultOpen />
                        ))}
                    </div>
                </section>
            </div>
            <EvidencePanel />
        </EvidenceProvider>
    );
}
