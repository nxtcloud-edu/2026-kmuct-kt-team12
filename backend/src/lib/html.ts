// backend/src/lib/html.ts
// HTML 특수문자 이스케이프. siteTemplate의 모든 텍스트는 이 함수를 거친다.

const MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escape(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input).replace(/[&<>"']/g, (c) => MAP[c]);
}
