// src/screens/RunScreen.tsx
// 화면 2: 정리 중. Run.events 를 시간순으로 폴링해 보여준다. done 되면 마스터로 이동 버튼.
import { useParams, useNavigate } from 'react-router-dom';
import { useRunPolling } from '../hooks/useRunPolling';

export function RunScreen() {
    const { id = 'pf-demo', runId = '' } = useParams();
    const navigate = useNavigate();
    const run = useRunPolling(runId);

    return (
        <div className="container">
            <h2>정리 중…</h2>
            <p className="muted">
                {run?.status === 'done'
                    ? '정리가 끝났습니다.'
                    : run?.status === 'failed'
                      ? '정리 중 문제가 발생했습니다.'
                      : '링크를 읽고 활동을 묶는 중입니다.'}
            </p>

            <ul className="events">
                {(run?.events ?? []).map((e, i) => (
                    <li key={i}>
                        <span className="at">{new Date(e.at).toLocaleTimeString('ko-KR')}</span>
                        {e.message}
                    </li>
                ))}
                {!run && <li className="muted">시작하는 중…</li>}
            </ul>

            {run?.status === 'done' && (
                <div className="btn-row">
                    <button className="btn btn-primary" onClick={() => navigate(`/p/${id}`)}>
                        마스터 타임라인 보기
                    </button>
                </div>
            )}
        </div>
    );
}
