// 화면 5: 확인 (#/s/{id}/confirm)
// 챗봇처럼 질문이 하나씩. [예][아니오][건너뛰기]. "예" → 한 줄 보충(선택,200자)+[다음].
// 진행 "3/8". 자유 채팅 입력 없음. 끝나거나 "여기까지만" → generate Job.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Keyword, Question } from '../types';
import { TopBar, useToast, errMessage } from '../ui';

export function ConfirmScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [idx, setIdx] = useState(0);
  const [detailMode, setDetailMode] = useState(false);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([api.getQuestions(id), api.getKeywords(id)])
      .then(([qs, kw]) => {
        setQuestions(qs);
        setKeywords(kw.keywords);
        const firstPending = qs.findIndex((q) => q.status === 'pending');
        setIdx(firstPending === -1 ? qs.length : firstPending);
      })
      .catch((e) => toast.show(errMessage(e)));
  }, [id]);

  const kwName = useMemo(() => new Map(keywords.map((k) => [k.id, k.name])), [keywords]);
  const total = questions.length;
  const current = questions[idx];
  const done = !current;

  async function answer(a: 'yes' | 'no' | 'skip', withDetail?: string) {
    if (!id || !current) return;
    setBusy(true);
    try {
      const updated = await api.answerQuestion(id, current.id, a, withDetail);
      setQuestions((qs) => qs.map((q) => (q.id === updated.id ? updated : q)));
      setDetailMode(false);
      setDetail('');
      setIdx((i) => i + 1);
    } catch (e) {
      toast.show(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function onYes() {
    setDetailMode(true);
  }

  async function toGenerate() {
    if (!id) return;
    setBusy(true);
    try {
      const jobId = await api.startJob(id, 'generate');
      nav(`/s/${id}/job/${jobId}`);
    } catch (e) {
      toast.show(errMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar>
        {!done && <button className="btn" onClick={toGenerate} disabled={busy}>여기까지만</button>}
      </TopBar>
      <div className="container chat">
        <div className="progress">{Math.min(idx + (done ? 0 : 1), total)} / {total}</div>

        {current ? (
          <>
            <div className="bubble">
              <div className="kw">{kwName.get(current.keywordId) ?? ''}</div>
              {current.text}
            </div>

            {!detailMode ? (
              <div className="answer-buttons">
                <button className="btn btn-primary" onClick={onYes} disabled={busy}>예</button>
                <button className="btn" onClick={() => answer('no')} disabled={busy}>아니오</button>
                <button className="btn" onClick={() => answer('skip')} disabled={busy}>건너뛰기</button>
              </div>
            ) : (
              <div className="detail-box">
                <input
                  maxLength={200}
                  placeholder="한 줄 보충 설명 (선택)"
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && answer('yes', detail)}
                />
                <div className="btn-row">
                  <button className="btn btn-primary" onClick={() => answer('yes', detail)} disabled={busy}>다음</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div>
            <p className="answered">모든 질문을 확인했습니다.</p>
            <button className="btn btn-primary" onClick={toGenerate} disabled={busy}>포트폴리오 만들기</button>
          </div>
        )}
      </div>
    </>
  );
}
