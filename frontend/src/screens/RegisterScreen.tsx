// src/screens/RegisterScreen.tsx
// 화면 1: 등록. 상단 링크 입력창 + 파일 드롭존 + 출처 목록 + 정리하기.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Source } from '@shared/types';
import { api } from '../api';

function detectKind(url: string): Source['kind'] {
    if (url.includes('github.com')) return 'github';
    if (url.includes('notion')) return 'notion';
    if (url.includes('tistory.com')) return 'tistory';
    return 'web';
}

export function RegisterScreen() {
    const navigate = useNavigate();
    const [portfolioId, setPortfolioId] = useState<string>('');
    const [url, setUrl] = useState('');
    const [sources, setSources] = useState<Source[]>([]);
    const [drag, setDrag] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        (async () => {
            const id = await api.createPortfolio();
            setPortfolioId(id);
            const view = await api.getPortfolio(id);
            setSources(view.sources);
        })();
    }, []);

    async function addUrl() {
        if (!url.trim()) return;
        const { source } = await api.addSource(portfolioId, { kind: detectKind(url), url: url.trim() });
        setSources((s) => [...s, source]);
        setUrl('');
    }

    async function addFile(file: File) {
        const { source } = await api.addSource(portfolioId, {
            kind: 'file',
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
        });
        setSources((s) => [...s, source]);
        // 실제로는 uploadUrl 로 PUT 업로드. 데모(목)에서는 생략.
    }

    async function onDrop(e: React.DragEvent) {
        e.preventDefault();
        setDrag(false);
        for (const f of Array.from(e.dataTransfer.files)) await addFile(f);
    }

    async function removeSource(sourceId: string) {
        await api.deleteSource(portfolioId, sourceId);
        setSources((s) => s.filter((x) => x.id !== sourceId));
    }

    async function start() {
        setBusy(true);
        const runId = await api.startRun(portfolioId, 'build');
        navigate(`/p/${portfolioId}/run/${runId}`);
    }

    return (
        <div className="container">
            <h2>링크로 포트폴리오 만들기</h2>
            <p className="muted">블로그, 노션, 깃허브 링크를 넣으면 활동을 시간순으로 정리합니다.</p>

            <div className="linkform">
                <input
                    placeholder="https://github.com/... 또는 블로그·노션 링크"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addUrl()}
                />
                <button className="btn" onClick={addUrl}>
                    추가
                </button>
            </div>

            <div
                className={`dropzone${drag ? ' drag' : ''}`}
                onDragOver={(e) => {
                    e.preventDefault();
                    setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
            >
                파일(PDF·이미지)을 여기로 끌어다 놓으세요
            </div>

            <ul className="source-list">
                {sources.map((s) => (
                    <li key={s.id}>
                        <span className="kind-badge">{s.kind}</span>
                        <span style={{ flex: 1 }}>{s.url ?? s.fileName}</span>
                        <button className="btn" onClick={() => removeSource(s.id)}>
                            삭제
                        </button>
                    </li>
                ))}
                {sources.length === 0 && <li className="muted">아직 등록된 출처가 없습니다.</li>}
            </ul>

            <div className="btn-row">
                <button className="btn btn-primary" onClick={start} disabled={busy || sources.length === 0}>
                    정리하기
                </button>
            </div>
        </div>
    );
}
