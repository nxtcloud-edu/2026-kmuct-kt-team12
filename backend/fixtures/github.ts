// backend/fixtures/github.ts
// 깃허브 API 응답 샘플 (테스트용).

export const ghUser = { login: 'octo' };

export const ghRepos = [
  {
    name: 'portfolio-site',
    full_name: 'octo/portfolio-site',
    html_url: 'https://github.com/octo/portfolio-site',
    description: '개인 포트폴리오 정적 사이트',
    fork: false,
    owner: { login: 'octo' },
  },
  {
    name: 'forked-lib',
    full_name: 'octo/forked-lib',
    html_url: 'https://github.com/octo/forked-lib',
    description: '남의 라이브러리 fork',
    fork: true,
    owner: { login: 'octo' },
  },
  {
    name: 'tiny',
    full_name: 'octo/tiny',
    html_url: 'https://github.com/octo/tiny',
    description: '작은 실험',
    fork: false,
    owner: { login: 'octo' },
  },
];

export const ghReadmeLong =
  '# 포트폴리오 사이트\n\n' +
  'React 와 Vite 로 만든 개인 포트폴리오입니다. '.repeat(20) +
  '\n로그인 화면과 검색 기능을 직접 구현했습니다.';

export const ghLanguages = { TypeScript: 12000, CSS: 3000 };

export const ghCommitsMany = Array.from({ length: 30 }, (_, i) => ({
  commit: { message: `커밋 ${i}`, author: { date: `2024-03-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z` } },
}));

export const ghCommitsFew = [
  { commit: { message: '초기 커밋', author: { date: '2024-01-01T00:00:00Z' } } },
];
