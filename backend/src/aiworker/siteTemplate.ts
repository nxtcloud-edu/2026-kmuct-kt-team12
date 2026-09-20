// backend/src/aiworker/siteTemplate.ts
// 단일 index.html 생성. AI 가 HTML 을 쓰지 않는다. 코드 템플릿에 데이터를 끼워 넣는다.
// - 모든 텍스트는 escape 를 거친다. 기록 본문을 HTML 로 삽입하지 않는다.
// - 인라인 CSS, 스크립트 없음, 시스템 글꼴, 반응형, 인쇄용 CSS.
// - origin "answer" 경험 옆 "본인 확인" 배지, origin "record" 경험에 원본 링크.

import { escape } from '../lib/html.js';
import type { PortfolioContent, Experience, Keyword, RecordItem } from '../types.js';

export interface SiteData {
  content: PortfolioContent;
  keywords: Keyword[];
  experiences: Experience[];
  records: RecordItem[];
}

const CSS = `
:root{--ink:#1a1a1a;--muted:#6b7280;--line:#e3e6ea;--accent:#2f6feb;--soft:#eaf1fe;--warn:#b9770e;--warn-soft:#fdf3e2}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo',sans-serif;color:var(--ink);background:#fff;line-height:1.6}
.wrap{max-width:820px;margin:0 auto;padding:40px 20px 80px}
header h1{font-size:28px;margin:0 0 12px}
.intro p{margin:6px 0;color:#333}
h2{font-size:20px;margin:36px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--line)}
.skill{margin:14px 0}
.skill .name{font-weight:600}
.exps{list-style:none;padding:0;margin:8px 0}
.exps li{padding:6px 0;border-bottom:1px solid var(--line);display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.badge{font-size:12px;padding:1px 8px;border-radius:999px;background:var(--warn-soft);color:var(--warn);white-space:nowrap}
.src{font-size:12px;color:var(--accent);text-decoration:none}
.src:hover{text-decoration:underline}
.activity{margin:18px 0;padding:14px 16px;border:1px solid var(--line);border-radius:10px}
.activity .period{font-size:13px;color:var(--muted)}
.activity h3{margin:2px 0 8px;font-size:16px}
.activity ul{margin:0;padding-left:18px}
.activity a.origin{font-size:12px;color:var(--accent)}
footer{margin-top:48px;font-size:12px;color:var(--muted)}
@media print{body{background:#fff}.wrap{max-width:100%;padding:0}.activity{break-inside:avoid}}
`;

export function renderSite(data: SiteData): string {
  const { content } = data;
  const expById = new Map(data.experiences.map((e) => [e.id, e]));
  const recById = new Map(data.records.map((r) => [r.id, r]));

  const introHtml = content.intro.map((p) => `<p>${escape(p)}</p>`).join('\n');

  const skillsHtml = content.skills
    .map((s) => {
      const kw = data.keywords.find((k) => k.id === s.keywordId);
      if (!kw) return '';
      const exps = kw.experienceIds
        .map((id) => expById.get(id))
        .filter((e): e is Experience => !!e)
        .map((e) => renderExp(e, recById))
        .join('\n');
      return `<div class="skill"><div class="name">${escape(kw.name)}</div>
<div class="summary">${escape(s.summary)}</div>
<ul class="exps">${exps}</ul></div>`;
    })
    .join('\n');

  const activitiesHtml = content.activities
    .map((a) => {
      const rec = recById.get(a.recordId);
      const link = rec?.url
        ? `<a class="origin" href="${escape(rec.url)}" target="_blank" rel="noopener">원본 보기</a>`
        : '';
      const bullets = a.bullets.map((b) => `<li>${escape(b)}</li>`).join('\n');
      return `<div class="activity">
<div class="period">${escape(a.period)}</div>
<h3>${escape(a.title)}</h3>
<ul>${bullets}</ul>
${link}</div>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(content.headline)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header>
<h1>${escape(content.headline)}</h1>
<div class="intro">${introHtml}</div>
</header>
<section>
<h2>역량</h2>
${skillsHtml}
</section>
<section>
<h2>활동 타임라인</h2>
${activitiesHtml}
</section>
<footer>이 포트폴리오는 확인된 경험 자산만으로 자동 생성되었습니다. "본인 확인" 배지는 사용자가 직접 확인한 경험입니다.</footer>
</div>
</body>
</html>`;
}

function renderExp(e: Experience, recById: Map<string, RecordItem>): string {
  if (e.origin === 'answer') {
    return `<li>${escape(e.text)} <span class="badge">본인 확인</span></li>`;
  }
const link = rec?.url && /^https?:\/\//i.test(rec.url)
    ? ` <a class="src" href="${escape(rec.url)}" target="_blank" rel="noopener">원본</a>`
    : '';
  return `<li>${escape(e.text)}${link}</li>`;
}
