# 백엔드 구현 현황과 AWS 실연동 경계

_작성: 2026-09-20 · 대상: backend/_

## 요약

AWS 자격증명 없이 **백엔드 핵심 로직 전체를 순수 함수 + 포트 주입 + 모킹 테스트로 완성**했다.
외부 의존(Bedrock, DynamoDB, S3, GitHub/Notion, Worker 비동기 호출)은 전부 인터페이스(포트) 뒤에 있고,
지금은 인메모리/스텁 어댑터로 end-to-end가 돈다. 자격증명을 받으면 **포트 구현체와 SAM template.yaml만** 채우면 된다.

- 테스트: shared 11 + backend 41 = **52개 전부 통과**, tsc strict 통과.
- 문서 8장 운영 규칙 준수: 각 spec의 T1(가짜 데이터 end-to-end)이 실제로 돈다. shared/types.ts 정의는 원문 그대로.

## 완성된 것 (AWS 없이 동작·검증됨)

| 계층 | 파일 | 내용 |
|---|---|---|
| 타입 계약 | `shared/types.ts`, `shared/validators.ts` | design.md 5장 원문 + verifyQuote/validateEntry/validateTailored |
| 포트 | `backend/src/ports.ts` | BedrockPort(tool use), StorePort, BlobPort, HttpPort, WorkerInvoker, Clock, IdGen |
| 유틸 | `backend/src/util.ts` | sha256, contentId(결정적 id), mapWithConcurrency, retry(지수 백오프) |
| 인메모리 어댑터 | `backend/src/adapters/memory.ts` | MemoryStore, MemoryBlob (테스트/로컬용) |
| 01 수집 | `backend/src/collect/*` | github/web/notion 어댑터, collect(해시·spill·저장), prepareFile(presigned) |
| 02 파이프라인 | `backend/src/pipeline/{extract,consolidate,master,refresh}.ts` | 추출(verifyQuote 폐기)·통합·마스터(validateEntry 강제)·갱신(변경분만+lockedFields 보존) |
| 03 직무맞춤 | `backend/src/pipeline/tailor.ts` | interpretRole·rankActivities·composeTailored(validateTailored 강제)·공백 리포트 |
| Worker | `backend/src/worker/worker.ts` | build/refresh/tailor 모드 배선, Run.events, status 전이 |
| API | `backend/src/api/api.ts` | design.md 7장 10개 엔드포인트 라우터 |

### 환각 방지가 코드로 강제됨 (문서의 핵심 주장)

- 추출: `verifyQuote` 통과 못 한 인용은 폐기 (extract.ts). start/end는 코드가 계산.
- 마스터: `validateEntry` 위반 시 1회 재시도 후 위반 문장 삭제 (master.ts).
- 맞춤본: `validateTailored`로 선택된 활동의 근거 집합 밖 evidenceId 차단 (tailor.ts).

### 결정론적 id (설계 개선)

refresh 간 활동 정체성을 유지하려고 id를 내용 기반으로 만들었다.
- evidence id = `contentId('evd', artifactId, field, quote)`
- activityId = `contentId('act', ...정렬된 evidenceIds)`

이렇게 해야 "다시 불러오기" 시 lockedFields(사용자가 고친 칸)가 같은 활동에 이어진다.

## 아직 안 된 것 (자격증명·전제 받은 뒤)

문서 6장·10장이 요구한 전제가 필요하다: **리전, Bedrock Claude 모델 접근, GitHub 토큰, Notion 통합 토큰**.

### 1. 포트 구현체 (`backend/src/adapters/aws/`)

| 포트 | 구현할 것 | 필요한 npm | 비고 |
|---|---|---|---|
| StorePort | `DynamoStore` | `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb` | PK `PF#{portfolioId}`, SK 종류별. getTailoredById는 GSI 또는 SK begins_with |
| BlobPort | `S3Blob` | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | putText/getText/presignPut |
| BedrockPort | `BedrockConverse` | `@aws-sdk/client-bedrock-runtime` | Converse API + toolConfig(스키마 강제), document/image 블록 |
| JobInvoker | `LambdaJobInvoker` | `@aws-sdk/client-lambda` | InvocationType='Event'(비동기). Collector·Pipeline Lambda 를 kind 로 라우팅 |
| HttpPort | `FetchHttp` | (내장 fetch) | 이미 Node 내장으로 구현 가능 |
| HtmlExtractor | Readability 구현 | `@mozilla/readability`, `linkedom` | web.ts의 basicHtmlExtractor 교체 |

> Lambda 는 기능별로 3개(API·Collector·Pipeline)로 분리됨. 구조도는 `ARCHITECTURE.md` 참고.
> 핸들러 엔트리(순수)는 이미 있음: `api/handler.ts`, `collector/handler.ts`, `pipeline/handler.ts`.
> 각 `buildXxxDeps()`(어댑터 조립)와 `export const handler`(AWS 엔트리)만 SDK 연결 후 채우면 된다.

> 새 npm 의존성이므로 tech.md 규칙상 **추가 전 확인 필요**. 위 목록은 design.md 6장이 이미 인프라로 명시한 것과 일치.

### 2. Lambda 엔트리포인트

- `backend/src/api/handler.ts`: API Gateway HTTP API 이벤트 → `ApiRequest`로 변환 → `handle()` 호출 → `ApiResponse`를 API Gateway 응답으로.
- `backend/src/worker/handler.ts`: 비동기 이벤트(WorkerJob) → `runBuild`/`runTailor` 호출.
- 두 핸들러에서 실제 어댑터로 `Deps`/`ApiDeps`를 조립(환경변수 BEDROCK_MODEL_ID, EXTRACT_CONCURRENCY, GITHUB_TOKEN, NOTION_TOKEN, 테이블명, 버킷명).

### 3. SAM `template.yaml` (한 파일)

- API Gateway HTTP API + API Lambda(위 handler)
- Worker Lambda (제한 시간 15분, 비동기 호출 권한)
- DynamoDB 단일 테이블 (온디맨드, PK/SK)
- S3 버킷 (업로드/원문) + presigned 권한
- IAM: API→Worker invoke, Worker→Bedrock/DynamoDB/S3
- 프론트 정적 호스팅(S3 + CloudFront)은 04-frontend 완료 후

### 4. 통합 테스트 (실제 Bedrock)

- 각 spec의 tasks에 있는 "통합 테스트 스크립트(실제 호출)"는 단위 테스트와 분리해 CI에서 제외. 당일 리허설용.

## 시작 전 확인 (문서 10장)

- [ ] AWS 리전과 그 리전의 Bedrock Claude 모델 접근 권한
- [ ] Bedrock 분당 호출 한도 (낮으면 EXTRACT_CONCURRENCY=2)
- [ ] GitHub 토큰
- [ ] Notion 통합 토큰 + 데모 페이지 공유

## 테스트 실행

```bash
cd backend && npm install && npm test   # tsc + node:test, 41개
cd shared  && npm install && npm test   # 11개
```
