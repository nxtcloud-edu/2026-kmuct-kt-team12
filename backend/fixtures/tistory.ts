// backend/fixtures/tistory.ts
// 티스토리 RSS XML 과 글 HTML 샘플.

export const tistoryRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>개발 블로그</title>
    <item>
      <title>스프링 부트로 REST API 만들기</title>
      <link>https://myblog.tistory.com/10</link>
      <pubDate>Mon, 04 Mar 2024 09:00:00 +0900</pubDate>
      <description>&lt;p&gt;짧은 요약&lt;/p&gt;</description>
    </item>
    <item>
      <title>JPA 연관관계 정리</title>
      <link>https://myblog.tistory.com/11</link>
      <pubDate>Tue, 12 Mar 2024 09:00:00 +0900</pubDate>
      <description><![CDATA[${'<p>충분히 긴 본문입니다. </p>'.repeat(60)}]]></description>
    </item>
  </channel>
</rss>`;

// description 이 짧은 글의 실제 페이지 HTML (Readability 대상)
export const tistoryPostHtml = `<!doctype html><html><head><title>스프링 부트로 REST API 만들기</title></head>
<body><article><h1>스프링 부트로 REST API 만들기</h1>
<p>${'스프링 부트로 컨트롤러와 서비스 계층을 나누어 REST API 를 구현했다. '.repeat(30)}</p>
<p>JWT 인증 필터도 직접 붙였다.</p></article></body></html>`;
