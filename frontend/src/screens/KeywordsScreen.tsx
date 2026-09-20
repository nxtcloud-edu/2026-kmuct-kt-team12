// 화면 4: 키워드 (#/s/{id}/keywords)
// 키워드별 접고 펼치는 트리. 경험 클릭 시 근거 quote + 기록 제목. "확인 질문 받기" → questions Job.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Keyword, Experience, RecordItem } from '../types';
import { TopBar, useToast, errMessage } from '../ui';

export function KeywordsScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [activeExp, setActiveExp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([api.getKeywords(id), api.getRecords(id)])
      .then(([kw, recs]) => {
        setKeywords(kw.keywords);
        setExperiences(kw.experiences);
        setRecords(recs);
        setOpen(Object.fromEntries(kw.keywords.map((k) => [k.id, true])));
      })
      .catch((e) => toast.show(errMessage(e)));
  }, [id]);

  const expById = new Map(experiences.map((e) => [e.id, e]));
  const recById = new Map(records.map((r) => [r.id, r]));

  async function toQuestions() {
    if (!id) return;
    setBusy(true);
    try {
      const jobId = await api.startJob(id, 'questions');
      nav(`/s/${id}/job/${jobId}`);
    } catch (e) {
      toast.show(errMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar>
        <button className="btn btn-primary" onClick={toQuestions} disabled={busy || keywords.length === 0}>
          확인 질문 받기
        </button>
      </TopBar>
      <div className="container">
        <h2>키워드와 경험</h2>
        <p className="muted">AI가 기록에서 뽑은 키워드와 경험입니다. 경험을 누르면 근거를 볼 수 있습니다.</p>

        {keywords.map((k) => (
          <div key={k.id} className="kw-node">
            <div className="kw-head" onClick={() => setOpen((o) => ({ ...o, [k.id]: !o[k.id] }))}>
              <span>{open[k.id] ? '▾' : '▸'}</span>
              <span>{k.name}</span>
              <span className="kw-count">경험 {k.experienceIds.length}개</span>
            </div>
            {open[k.id] && (
              <ul className="exp-list">
                {k.experienceIds.map((eid) => {
                  const exp = expById.get(eid);
                  if (!exp) return null;
                  const rec = exp.recordIds.map((rid) => recById.get(rid)).find(Boolean);
                  return (
                    <li key={eid} className="exp-item" onClick={() => setActiveExp(activeExp === eid ? null : eid)}>
                      <span>{exp.text}</span>{' '}
                      {exp.origin === 'answer' && <span className="badge-answer">본인 확인</span>}
                      {activeExp === eid && (
                        <div className="exp-quote">
                          {exp.quote ? exp.quote : '본인이 확인한 경험입니다.'}
                          {rec && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>출처: {rec.title}</div>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
        {keywords.length === 0 && <p className="muted">키워드가 아직 없습니다.</p>}
      </div>
    </>
  );
}
