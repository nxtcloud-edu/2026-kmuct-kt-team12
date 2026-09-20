// backend/src/collector/normalize.ts
// 2단계: 세 출처의 원시 데이터를 RecordItem 공통 형식으로 변환.
// HTML 태그 제거, 연속 공백 정리, 40,000자 초과분 잘라내기.
// 자동 제외 규칙에 걸린 기록은 버리지 않고 excluded/excludedReason 로 저장.

import type { RecordItem, SourceKind } from '../types.js';

export const BODY_LIMIT = 40_000;

// 출처 어댑터가 만드는 중간 형태 (id/sessionId/excluded 는 normalize/collect 가 채움)
export interface RawRecord {
  source: SourceKind;
  // url 이 안정적 식별자. 재수집 시 이 값으로 기존 기록을 덮어쓴다.
  url: string;
  title: string;
  timeStart?: string;
  timeEnd?: string;
  body: string;
  meta: RecordItem['meta'];
  // 어댑터가 판단한 자동 제외 사유 (있으면 excluded=true)
  autoExcludeReason?: string;
}

export function stripHtml(html: unknown): string {
  if (typeof html !== 'string') html = html == null ? '' : String(html);
  return (html as string)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function collapseWhitespace(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
}

export function cleanText(raw: string): string {
  return collapseWhitespace(stripHtml(raw)).slice(0, BODY_LIMIT);
}

// 결정론적 id: 출처 + url 기반. 재수집 시 같은 url → 같은 id → 덮어쓰기.
export function recordId(source: SourceKind, url: string): string {
  let h = 0;
  const s = `${source}\u0000${url}`;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return `${source}-${(h >>> 0).toString(36)}`;
}

// RawRecord → RecordItem. body는 cleanText 로 정리(어댑터가 이미 정리했어도 안전).
export function toRecordItem(sessionId: string, raw: RawRecord): RecordItem {
  const body = cleanText(raw.body);
  const item: RecordItem = {
    id: recordId(raw.source, raw.url),
    sessionId,
    source: raw.source,
    title: raw.title.trim() || '(제목 없음)',
    body,
    url: raw.url,
    excluded: false,
    meta: raw.meta,
  };
  if (raw.timeStart) item.timeStart = raw.timeStart;
  if (raw.timeEnd) item.timeEnd = raw.timeEnd;

  // 어댑터가 지정한 자동 제외 + 공통 규칙(본문 200자 미만)
  const reason = raw.autoExcludeReason ?? (body.length < 200 ? '본문이 너무 짧음' : undefined);
  if (reason) {
    item.excluded = true;
    item.excludedReason = reason;
  }
  return item;
}
