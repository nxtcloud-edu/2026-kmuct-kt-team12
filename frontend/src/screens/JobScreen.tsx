// 화면 2: 진행 (#/s/{id}/job/{jobId})
// 폴링해 events를 쌓아 보여준다. done이면 kind에 따라 다음 화면으로.
// failed면 마지막 메시지 + 다시 시도. 5분 초과 running이면 안내.

import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useJobPolling } from '../useJobPolling';
import { TopBar } from '../ui';
import type { JobKind } from '../types';

const NEXT_PATH: Record<JobKind, (sid: string) => string> = {
  collect: (sid) => `/s/${sid}/timeline`,
  keywords: (sid) => `/s/${sid}/keywords`,
  questions: (sid) => `/s/${sid}/confirm`,
  generate: (sid) => `/s/${sid}/site`,
};

export function JobScreen() {
  const { id, jobId } = useParams();
  const nav = useNavigate();
  const { job, timedOut, error } = useJobPolling(jobId);

  useEffect(() => {
    if (job?.status === 'done' && id) {
      const to = NEXT_PATH[job.kind](id);
      const t = setTimeout(() => nav(to), 600);
      return () => clearTimeout(t);
    }
  }, [job?.status, job?.kind, id, nav]);

  return (
    <>
      <TopBar />
      <div className="container">
        <h2>{title(job?.kind)}</h2>

        {error && !job && <p className="status-fail">{error}</p>}

        <ul className="events">
          {job?.events.map((ev, i) => (
            <li key={i}>
              <span className="at">{ev.at.slice(11, 19)}</span>
              {ev.message}
            </li>
          ))}
        </ul>

        {job?.status === 'running' && !timedOut && (
          <p className="muted"><span className="spinner" /> 진행 중입니다…</p>
        )}

        {timedOut && (
          <p className="status-fail">시간이 오래 걸리고 있습니다. 잠시 후 새로고침하거나 다시 시도하세요.</p>
        )}

        {job?.status === 'failed' && (
          <div>
            <p className="status-fail">
              {job.events[job.events.length - 1]?.message ?? '작업에 실패했습니다.'}
            </p>
            <button className="btn btn-primary" onClick={() => nav('/')}>다시 시도</button>
          </div>
        )}
      </div>
    </>
  );
}

function title(kind?: JobKind): string {
  switch (kind) {
    case 'collect': return '활동을 모으는 중';
    case 'keywords': return '키워드로 정리하는 중';
    case 'questions': return '확인 질문을 준비하는 중';
    case 'generate': return '포트폴리오를 만드는 중';
    default: return '진행 중';
  }
}
