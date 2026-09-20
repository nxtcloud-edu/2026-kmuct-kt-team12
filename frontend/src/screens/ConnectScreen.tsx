// 화면 1: 연결 (#/)
// 깃허브 토큰/노션 토큰/티스토리 주소 입력(하나 이상). 연결 확인 → 가져오기(collect).
// 토큰은 메모리에만. localStorage 저장 안 함. 입력칸 type="password".

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { Connections } from '../types';
import type { VerifyResult } from '../api';
import { TopBar, useToast, errMessage } from '../ui';

export function ConnectScreen() {
  const nav = useNavigate();
  const toast = useToast();
  const [githubToken, setGithubToken] = useState('');
  const [notionToken, setNotionToken] = useState('');
  const [tistoryUrl, setTistoryUrl] = useState('');
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);

  function conn(): Connections {
    const c: Connections = {};
    if (githubToken.trim()) c.githubToken = githubToken.trim();
    if (notionToken.trim()) c.notionToken = notionToken.trim();
    if (tistoryUrl.trim()) c.tistoryUrl = tistoryUrl.trim();
    return c;
  }
  const hasAny = !!(githubToken.trim() || notionToken.trim() || tistoryUrl.trim());

  async function onVerify() {
    if (!hasAny) {
      toast.show('하나 이상의 출처를 입력하세요.');
      return;
    }
    setBusy(true);
    try {
      const sessionId = await api.createSession();
      sessionStorage.setItem('lastSession', sessionId);
      const res = await api.verifyConnections(sessionId, conn());
      setVerify(res);
    } catch (e) {
      toast.show(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onCollect() {
    if (!hasAny) {
      toast.show('하나 이상의 출처를 입력하세요.');
      return;
    }
    setBusy(true);
    try {
      const sessionId = sessionStorage.getItem('lastSession') ?? (await api.createSession());
      sessionStorage.setItem('lastSession', sessionId);
      const jobId = await api.startJob(sessionId, 'collect', conn());
      nav(`/s/${sessionId}/job/${jobId}`);
    } catch (e) {
      toast.show(errMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar />
      <div className="container">
        <h2>흩어진 활동을 한 곳에서</h2>
        <p className="muted">깃허브·노션·티스토리 중 하나 이상을 연결하면 활동을 모아 시간순으로 정리합니다.</p>

        <div className="field">
          <label>깃허브 토큰</label>
          <input type="password" value={githubToken} placeholder="ghp_..." autoComplete="off"
            onChange={(e) => setGithubToken(e.target.value)} />
          {verify?.github && <VerifyRow label="깃허브" status={verify.github} />}
        </div>

        <div className="field">
          <label>노션 토큰</label>
          <input type="password" value={notionToken} placeholder="secret_..." autoComplete="off"
            onChange={(e) => setNotionToken(e.target.value)} />
          {verify?.notion && <VerifyRow label="노션" status={verify.notion} />}
        </div>

        <div className="field">
          <label>티스토리 블로그 주소</label>
          <input type="text" value={tistoryUrl} placeholder="myblog.tistory.com"
            onChange={(e) => setTistoryUrl(e.target.value)} />
          {verify?.tistory && <VerifyRow label="티스토리" status={verify.tistory} />}
        </div>

        <div className="btn-row">
          <button className="btn" onClick={onVerify} disabled={busy || !hasAny}>연결 확인</button>
          <button className="btn btn-primary" onClick={onCollect} disabled={busy || !hasAny}>가져오기</button>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>토큰은 브라우저 메모리에만 사용되며 저장되지 않습니다.</p>
      </div>
    </>
  );
}

function VerifyRow({ label, status }: { label: string; status: 'ok' | 'fail' }) {
  return (
    <div className="verify-row">
      <span className={status === 'ok' ? 'status-ok' : 'status-fail'}>
        {label} {status === 'ok' ? '연결 성공' : '연결 실패'}
      </span>
    </div>
  );
}
