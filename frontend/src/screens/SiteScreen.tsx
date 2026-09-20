// 화면 6: 결과 (#/s/{id}/site)
// 공유 주소, 복사, 새 탭 열기, iframe 미리보기, 다시 만들기.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, usingMock } from '../api';
import type { SiteInfo } from '../types';
import { TopBar, useToast, errMessage } from '../ui';

export function SiteScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.getSite(id).then(setSite).catch((e) => toast.show(errMessage(e)));
  }, [id]);

  async function copy() {
    if (!site) return;
    try {
      await navigator.clipboard.writeText(site.url);
      toast.show('주소를 복사했습니다.', 'info');
    } catch {
      toast.show('복사에 실패했습니다. 주소를 직접 선택해 복사하세요.');
    }
  }

  async function regenerate() {
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
        <button className="btn" onClick={regenerate} disabled={busy}>다시 만들기</button>
      </TopBar>
      <div className="container">
        <h2>포트폴리오가 완성되었습니다</h2>
        {!site ? (
          <p className="muted">아직 생성된 사이트가 없습니다.</p>
        ) : (
          <>
            <div className="share-box">
              <code>{site.url}</code>
              <button className="btn" onClick={copy}>복사</button>
              {!usingMock && (
                <a className="btn" href={site.url} target="_blank" rel="noopener noreferrer">새 탭</a>
              )}
            </div>
            {usingMock ? (
              <p className="muted">목 모드에서는 미리보기를 제공하지 않습니다. 실제 배포 시 여기에 사이트가 표시됩니다.</p>
            ) : (
              <iframe className="preview-frame" src={site.url} title="포트폴리오 미리보기" />
            )}
          </>
        )}
      </div>
    </>
  );
}
