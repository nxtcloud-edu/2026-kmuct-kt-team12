# 설계 — 포트폴리오 생성기 (재설계)

## 아키텍처

Lambda 3개 + DynamoDB 단일 테이블 + S3. 리전 us-east-1 고정.

```
브라우저(Amplify, HashRouter)
   │ fetch
API Gateway HTTP API ($default → api Lambda)
   │
[api Lambda] 동기·라우터
   │ DISPATCH_MODE=invoke → LambdaClient InvokeCommand(Event)
   │ DISPATCH_MODE=sqs    → SQSClient SendMessage
   ├──▶ [collector Lambda] 비동기 (1·2단계, AI 없음) ──▶ DynamoDB(REC#)
   └──▶ [ai-worker Lambda] 비동기 (4·5·6단계, Bedrock) ──▶ DynamoDB(KW#/EXP#/Q#/SITE) + S3(sites/{id}/index.html)
DynamoDB 단일 테이블: PK=SES#{sessionId}, SK=META/REC#/KW#/EXP#/Q#/JOB#/SITE
```

작업 Lambda는 직접호출 이벤트와 SQS 이벤트(event.Records[].body) 모두 처리.
payload = `{ sessionId, jobId, kind, connections? }` (connections는 collect일 때만).

## 저장소 구조

```
backend/
  src/types.ts                     명세 4장 타입 그대로
  src/lib/{db,bedrock,dispatch,safeFetch,jobs,html}.ts
  src/api/{index,router}.ts  src/api/routes/*.ts
  src/collector/{index,github,notion,tistory,normalize}.ts
  src/aiworker/{index,keywords,questions,generate,prompts,siteTemplate}.ts
  scripts/build.mjs                esbuild + archiver → dist/{api,collector,ai-worker}.zip
  fixtures/                        테스트 샘플
frontend/                          Vite + React, type-only import
docs/console-setup.md
```

## lib 계약

- **db.ts**: DynamoDBDocumentClient(region us-east-1). `putItem/getItem/queryByPrefix(pageination)/updateJob(list_append)/deleteItems`. 키 헬퍼 `pk(sessionId)`, SK 빌더. 테스트는 in-memory fake store 주입.
- **safeFetch.ts**: http/https만, 사설/루프백 IP 차단, 리다이렉트 3회 매번 재검사, 타임아웃 10초, 2MB 제한, UA 명시. DNS는 hostname 패턴으로 1차 차단(명세 범위: 10.x/172.16-31/192.168/127/169.254/localhost/IPv6 루프백).
- **bedrock.ts**: `converse({system, records, tool})` — ConverseCommand + toolConfig + toolChoice 강제, maxTokens 명시, Throttling/ModelTimeout/ServiceUnavailable 1s·3s 2회 재시도. toolUse.input만 반환.
- **dispatch.ts**: DISPATCH_MODE 분기(invoke/sqs). 대상 함수명·큐 URL 환경변수.
- **jobs.ts**: Job 생성, startedAt 조건부 쓰기(중복 방지), event append, status 전환, 남은시간 체크 헬퍼. 예외 래핑(runJob(handler)).
- **html.ts**: `escape(s)` HTML 특수문자 이스케이프.

## DynamoDB 접근

- 조회: PK 일치 + SK begins_with Query, LastEvaluatedKey 페이지네이션.
- Job.events: UpdateItem list_append (읽고 덮어쓰기 금지).
- jobId="{sessionId}.{랜덤}", GET /jobs/{jobId}는 마지막 점 앞으로 PK 역산.

## api 라우팅

프레임워크 없이 method+path 패턴 매칭 라우터. HTTP API payload v2(`event.requestContext.http.method`, `event.rawPath`, `event.pathParameters` 대신 직접 파싱). CORS 헤더 안 넣음. `/sites/{sessionId}`만 text/html 반환.

## collector

- github: /user/repos(owner,pushed,MAX_REPOS) → repo별 README(raw)/languages/commits(author=login,per_page30) + Link last 페이지로 첫 커밋일. body=설명+README+커밋메시지. 자동제외: fork / 내커밋<3 / body<200자.
- notion: /v1/search(page, MAX_PAGES) → /v1/blocks/{id}/children 깊이3 재귀 텍스트화. Notion-Version 필수. HTML 스크랩 안 함.
- tistory: {url}/rss fast-xml-parser 파싱. description<500자면 link를 linkedom+Readability로 본문 추출, 실패 시 태그 제거. 최근 MAX_POSTS.
- normalize: RecordItem 공통형식, 태그 제거·공백 정리·40000자 컷, 자동제외 표시, 재수집 시 url 기준 덮어쓰기(excluded 유지).

## ai-worker

- keywords: 기록별 병렬(직접 만든 concurrency 제한 함수) → quote 검증 → 키워드 통일 → 저장(record 재생성).
- questions: 1회 호출 → 검증(존재/중복/8개) → pending 재생성.
- generate: yes→answer 변환(detail 있으면 다듬기) → PortfolioContent 1회 → 검증 → siteTemplate → S3 → SiteInfo.
- siteTemplate: 인라인 CSS, 스크립트 없음, 반응형+인쇄용. answer=본인확인 배지, record=원본링크. 모든 텍스트 escape.

## frontend

HashRouter 6화면(연결/진행/타임라인/키워드/확인/결과). src/api.ts 단일, VITE_USE_MOCK 시 src/mocks/. 순수 CSS(기존 styles.css 색·컴포넌트 재사용), 강조색 1개. 텍스트 렌더만. build에 tsc --noEmit 포함.

## 빌드

- backend: scripts/build.mjs → esbuild(node/esm/node20, AWS SDK 포함) 단일 index.mjs 3개 → archiver zip. zip 루트 index.mjs, 핸들러 index.handler.
- frontend: vite build → dist/. package → site.zip(dist 내용물 루트).

## 테스트 (전부 모킹, vitest)

fixtures(github JSON, notion JSON, tistory RSS/HTML). collector/ai-worker/api/작업Lambda/safeFetch 단위테스트. frontend는 jsdom 금지이므로 순수 로직(api mock 전환, 상태 헬퍼) 테스트.

## 결정 로그 (모호한 부분 합리적 결정)

최종 보고 표 참조.
