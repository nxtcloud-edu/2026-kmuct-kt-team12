// 화면 3: 타임라인 (#/s/{id}/timeline)
// 시간순 카드. 포함/제외 체크(PATCH). 자동 제외는 흐리게 + 사유. "키워드 정리하기" → keywords Job.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { RecordItem, SourceKind } from '../types';
import { TopBar, useToast, errMessage } from '../ui';

const SOURCE_LABEL: Record<SourceKind, string> = { github: '깃허브', notion: '노션', tistory: '티스토리' };

export function TimelineScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.getRecords(id).then(setRecords).catch((e) => toast.show(errMessage(e)));
  }, [id]);

  async function toggle(rec: RecordItem) {
    if (!id) return;
    try {
      const updated = await api.patchRecord(id, rec.id, !rec.excluded);
      setRecords((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
    } catch (e) {
      toast.show(errMessage(e));
    }
  }

  async function toKeywords() {
    if (!id) return;
    setBusy(true);
    try {
      const jobId = await api.startJob(id, 'keywords');
      nav(`/s/${id}/job/${jobId}`);
    } catch (e) {
      toast.show(errMessage(e));
      setBusy(false);
    }
  }

  const included = records.filter((r) => !r.excluded).length;

  return (
    <>
      <TopBar>
        <button className="btn btn-primary" onClick={toKeywords} disabled={busy || included === 0}>
          키워드 정리하기
        </button>
      </TopBar>
      <div className="container">
        <h2>활동 타임라인</h2>
        <p className="muted">포트폴리오에서 뺄 기록은 체크를 해제하세요. 현재 {included}개 포함.</p>

        <div className="timeline">
          {records.map((r) => (
            <div key={r.id} className={`tl-card${r.excluded ? ' excluded' : ''}`}>
              <div className="tl-head">
                <span className="kind-badge">{SOURCE_LABEL[r.source]}</span>
                <span className="tl-title">{r.title}</span>
                <label className="muted" style={{ fontSize: 13 }}>
                  <input type="checkbox" checked={!r.excluded} onChange={() => toggle(r)} /> 포함
                </label>
              </div>
              <div className="tl-period">{period(r)}</div>
              {r.excludedReason && <div style={{ marginTop: 6 }}><span className="reason-badge">{r.excludedReason}</span></div>}
              <div className="tl-body">{r.body.slice(0, 200)}{r.body.length > 200 ? '…' : ''}</div>
              <a className="src-link" href={r.url} target="_blank" rel="noopener noreferrer">원본 보기</a>
            </div>
          ))}
          {records.length === 0 && <p className="muted">표시할 기록이 없습니다.</p>}
        </div>
      </div>
    </>
  );
}

function period(r: RecordItem): string {
  const s = r.timeStart?.slice(0, 10);
  const e = r.timeEnd?.slice(0, 10);
  if (s && e && s !== e) return `${s} ~ ${e}`;
  return s ?? e ?? '기간 미상';
}
