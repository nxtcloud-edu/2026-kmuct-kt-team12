// backend/src/pipeline/publish.ts
// 맞춤 포트폴리오를 독립 정적 HTML 페이지로 생성한다.
// 외부 CSS/JS 의존 없이 인라인 스타일만 사용, S3에 업로드 가능.

import type { TailoredOutput, Evidence, Artifact, ActivityEntry, Sentence } from '../../../shared/types.js';

/** 문장 배열을 단순 텍스트로 합친다. */
function renderSentences(sentences: Sentence[]): string {
    return sentences.map((s) => escapeHtml(s.text)).join(' ');
}

/** HTML 특수문자 이스케이프 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** 활동 유형 한글 라벨 */
function typeLabel(type: ActivityEntry['type']): string {
    const map: Record<ActivityEntry['type'], string> = {
        project: '프로젝트',
        club: '동아리',
        contest: '대회',
        intern: '인턴',
        study: '스터디',
        etc: '기타',
    };
    return map[type] ?? type;
}

/** 기간 텍스트 */
function periodText(entry: ActivityEntry): string {
    if (!entry.period) return '';
    const { start, end } = entry.period;
    if (!start && !end) return '';
    if (start && end) return `${start} ~ ${end}`;
    if (start) return `${start} ~`;
    return `~ ${end}`;
}

/** TailoredOutput + Evidence + Artifact → 완전한 독립 HTML 문자열 */
export function generateStaticPortfolio(
    output: TailoredOutput,
    evidence: Evidence[],
    artifacts: Artifact[],
): string {
    // 사용하지 않더라도 인자로 받아 향후 근거 링크 등 확장 가능
    void evidence;
    void artifacts;

    const gaps = output.competencies.filter((c) => c.evidenceIds.length === 0);
    const filled = output.competencies.filter((c) => c.evidenceIds.length > 0);

    const entriesHtml = output.entries
        .map((entry) => {
            const techChips = entry.tech
                .map((t) => `<span class="chip">${escapeHtml(t)}</span>`)
                .join('');

            const whatHtml = entry.what.length
                ? entry.what.map((s) => `<li>${escapeHtml(s.text)}</li>`).join('')
                : '';
            const howHtml = entry.how.length
                ? entry.how.map((s) => `<li>${escapeHtml(s.text)}</li>`).join('')
                : '';
            const resultHtml = entry.result.length
                ? entry.result.map((s) => `<li>${escapeHtml(s.text)}</li>`).join('')
                : '';

            const period = periodText(entry);

            return `
        <div class="card">
            <div class="card-header">
                <div class="card-title">${escapeHtml(entry.title.text)}</div>
                <div class="card-meta">
                    <span class="type-badge">${typeLabel(entry.type)}</span>
                    ${period ? `<span class="period">${escapeHtml(period)}</span>` : ''}
                </div>
            </div>
            <p class="summary">${escapeHtml(entry.summary.text)}</p>
            ${whatHtml ? `<div class="field"><div class="field-label">무엇을</div><ul>${whatHtml}</ul></div>` : ''}
            ${howHtml ? `<div class="field"><div class="field-label">어떻게</div><ul>${howHtml}</ul></div>` : ''}
            ${resultHtml ? `<div class="field"><div class="field-label">결과</div><ul>${resultHtml}</ul></div>` : ''}
            ${techChips ? `<div class="field"><div class="field-label">기술 스택</div><div class="chips">${techChips}</div></div>` : ''}
        </div>`;
        })
        .join('\n');

    const competencyTagsHtml = [
        ...filled.map((c) => `<span class="tag">${escapeHtml(c.name)}</span>`),
        ...gaps.map((c) => `<span class="tag gap">${escapeHtml(c.name)}</span>`),
    ].join('\n            ');

    const introHtml = output.intro
        .map((s) => `<p>${escapeHtml(s.text)}</p>`)
        .join('\n            ');

    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(output.targetRole)} 포트폴리오</title>
    <style>
        /* 기본 리셋 및 변수 */
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
            --bg: #f7f8fa;
            --card: #ffffff;
            --ink: #1a1a1a;
            --muted: #8a8f98;
            --line: #e3e6ea;
            --accent: #2f6feb;
            --accent-soft: #eaf1fe;
            --gray-empty: #f0f1f3;
            --warn: #b9770e;
            --warn-soft: #fdf3e2;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Pretendard', sans-serif;
            background: var(--bg);
            color: var(--ink);
            line-height: 1.7;
            -webkit-font-smoothing: antialiased;
        }

        /* 레이아웃 */
        .page { max-width: 800px; margin: 0 auto; padding: 48px 24px 80px; }

        /* 헤더 */
        .header {
            text-align: center;
            margin-bottom: 40px;
            padding-bottom: 32px;
            border-bottom: 2px solid var(--line);
        }
        .header h1 {
            font-size: 28px;
            font-weight: 700;
            color: var(--ink);
            margin-bottom: 4px;
        }
        .header .subtitle {
            font-size: 14px;
            color: var(--muted);
        }

        /* 섹션 */
        .section { margin-bottom: 36px; }
        .section-title {
            font-size: 13px;
            font-weight: 600;
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 0.06em;
            margin-bottom: 12px;
            padding-bottom: 6px;
            border-bottom: 1px solid var(--line);
        }

        /* 자기소개 */
        .intro p {
            font-size: 15px;
            margin-bottom: 6px;
            color: var(--ink);
        }

        /* 역량 태그 */
        .tags { display: flex; gap: 8px; flex-wrap: wrap; }
        .tag {
            font-size: 13px;
            padding: 4px 14px;
            border-radius: 999px;
            background: var(--accent-soft);
            color: var(--accent);
            font-weight: 500;
        }
        .tag.gap {
            background: var(--gray-empty);
            color: var(--muted);
            text-decoration: line-through;
        }

        /* 활동 카드 */
        .card {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: 12px;
            padding: 20px 24px;
            margin-bottom: 16px;
            transition: box-shadow 0.15s;
        }
        .card:hover {
            box-shadow: 0 2px 12px rgba(0,0,0,0.06);
        }
        .card-header { margin-bottom: 10px; }
        .card-title {
            font-size: 17px;
            font-weight: 600;
            color: var(--ink);
            margin-bottom: 4px;
        }
        .card-meta {
            display: flex;
            gap: 10px;
            align-items: center;
            font-size: 13px;
            color: var(--muted);
        }
        .type-badge {
            font-size: 12px;
            padding: 2px 10px;
            border-radius: 999px;
            background: var(--accent-soft);
            color: var(--accent);
            font-weight: 500;
        }
        .period { color: var(--muted); }
        .summary {
            font-size: 14px;
            color: #444;
            margin-bottom: 12px;
            line-height: 1.6;
        }

        /* 필드(무엇을/어떻게/결과) */
        .field { margin-bottom: 10px; }
        .field-label {
            font-size: 12px;
            color: var(--muted);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            margin-bottom: 4px;
        }
        .field ul {
            list-style: none;
            padding: 0;
        }
        .field li {
            font-size: 14px;
            padding: 3px 0 3px 16px;
            position: relative;
            color: #333;
        }
        .field li::before {
            content: '';
            position: absolute;
            left: 0;
            top: 11px;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--accent);
            opacity: 0.5;
        }

        /* 기술 칩 */
        .chips { display: flex; gap: 6px; flex-wrap: wrap; }
        .chip {
            font-size: 12px;
            background: var(--accent-soft);
            color: var(--accent);
            padding: 3px 10px;
            border-radius: 999px;
        }

        /* 푸터 */
        .footer {
            text-align: center;
            padding-top: 32px;
            margin-top: 40px;
            border-top: 1px solid var(--line);
            font-size: 12px;
            color: var(--muted);
        }

        /* 인쇄용 */
        @media print {
            body { background: #fff; }
            .page { max-width: 100%; padding: 0; }
            .card { break-inside: avoid; box-shadow: none; border-color: #ddd; }
            .header { border-bottom-color: #ddd; }
            .footer { border-top-color: #ddd; }
        }

        /* 반응형 */
        @media (max-width: 600px) {
            .page { padding: 24px 16px 60px; }
            .header h1 { font-size: 22px; }
            .card { padding: 16px; }
        }
    </style>
</head>
<body>
    <div class="page">
        <header class="header">
            <h1>${escapeHtml(output.targetRole)} 포트폴리오</h1>
            <div class="subtitle">맞춤 포트폴리오</div>
        </header>

        <section class="section intro">
            <div class="section-title">자기소개</div>
            ${introHtml}
        </section>

        <section class="section">
            <div class="section-title">역량</div>
            <div class="tags">
                ${competencyTagsHtml}
            </div>
        </section>

        <section class="section">
            <div class="section-title">관련 활동</div>
            ${entriesHtml}
        </section>

        <footer class="footer">
            Generated at ${escapeHtml(output.generatedAt)}
        </footer>
    </div>
</body>
</html>`;
}
