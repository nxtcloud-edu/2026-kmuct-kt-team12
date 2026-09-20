# 작업 — 포트폴리오 생성기 (재설계)

- [ ] 1. 저장소 뼈대 + types.ts + lib/ + 모킹 테스트
  - backend package.json/tsconfig/vitest 재설정, src/types.ts(4장 그대로)
  - lib: db, bedrock, dispatch, safeFetch, jobs, html
  - safeFetch 차단목록 테스트, html escape 테스트, jobs 예외/중복 테스트
  - _R2, R9_

- [ ] 2. api 라우터와 전체 경로
  - router.ts(패턴 매칭), routes/*, index.ts(payload v2)
  - 테스트: 라우터 매칭, 선행조건 409, running 중복 409, answer 저장, /sites Content-Type
  - _R1, R2, R7_

- [ ] 3. collector 세 출처 + normalize
  - github/notion/tistory/normalize + collector/index.ts
  - fixtures + 테스트: 정규화, 자동제외, 출처 실패 계속, 재수집 excluded 유지
  - _R3_

- [ ] 4. ai-worker keywords→questions→generate + siteTemplate + prompts
  - 테스트: quote 폐기, 통일 모르는이름 무시, 질문 중복/8개, generate id삭제/기술명 bullet삭제, HTML escape, 같은 S3 키
  - _R4, R5, R6_

- [ ] 5. frontend 6화면 mock 우선 → 실제 api
  - HashRouter, api.ts, mocks/, 6화면, 순수 로직 테스트
  - _R8_

- [ ] 6. 빌드 스크립트 + docs/console-setup.md + 최종 보고
  - build.mjs zip 3개, frontend package site.zip, .gitignore
  - _R9_
