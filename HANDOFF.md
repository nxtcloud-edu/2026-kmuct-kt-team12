# HANDOFF — 포트폴리오 생성기 (2026-kmuct-kt-team12)

_작성: 2026-09-20 · 다른 에이전트/팀원이 맥락을 이어받기 위한 문서_

## 이 프로젝트가 뭔가

공개 링크(GitHub·Notion·블로그)와 로컬 파일(PDF·이미지)에서 활동 기록을 모아,
**모든 문장이 원문 인용에 연결된** "마스터 타임라인" 포트폴리오를 만들고,
그 근거 안에서만 **직무 맞춤 포트폴리오**를 뽑아내는 생성기.

- 핵심 차별점: **환각 방지를 프롬프트가 아니라 검증 코드로 강제**. 인용문이 원문에 없으면 저장 안 됨.
- 원 설계 문서: `docs/design.md` (PDF 기획서를 마크다운화한 것, 1~9장). **모든 판단의 근거는 이 파일.**
- 해커톤(키로톤) 프로젝트. AWS 서버리스로 배포 예정.

## 개발 방식 (중요)

`docs/design.md` 8장이 **Kiro spec 워크플로우**를 지정: steering 3개 → 타입 계약 → spec 4개 (design-first).
- `.kiro/steering/` : product.md, tech.md, structure.md (제품·기술·구조 규칙)
- `.kiro/specs/` : 01-collect, 02-pipeline-master, 03-tailor, 04-frontend (각 requirements/design/tasks)
- **규칙**: `shared/types.ts` 는 유일한 타입 출처. 바꾸기 전 팀 합의. tech.md 금지 목록(아래) 준수. 각 spec tasks 1번은 "가짜 데이터 end-to-end".

## 현재 상태 (2026-09-20)

**전부 구현·테스트 완료. AWS 실연동만 남음.**

| 영역 | 상태 | 테스트 |
|---|---|---|
| shared (타입+검증) | ✅ | 11 |
| backend (수집·파이프라인·맞춤·API) | ✅ | 42 |
| frontend (화면 5개) | ✅ | 5 |
| **합계** | | **58 통과** |

- PR **#4 (feature/mvp-backend-frontend → develop) 는 MERGED 됨.** 코드가 develop 에 있음.
- 기본 브랜치 `develop`. 브랜치 전략: `main`(배포) ← `develop`(통합) ← `feature/<기능>`. **develop 은 PR 승인 1 필수(ruleset)** — 직접 push 금지. (근거: 저장소 `DECISIONS.md`)

## 아키텍처 (구현됨)

3계층 파이프라인: **Artifact(원문) → Evidence(근거) → Output(마스터/맞춤)**

Lambda 는 기능별로 3개로 분리(구조도: `backend/ARCHITECTURE.md`):
- **API Lambda** — 접수(runId)·CRUD. 다음 단계를 비동기 invoke.
- **Collector Lambda** — 출처 병렬 수집 → Artifact 저장 → pipeline invoke.
- **Pipeline Lambda** — 추출→통합→마스터(build/refresh) + 직무맞춤(tailor).
- 단계 연결: **Step Functions 금지**라 `JobInvoker` 포트로 Lambda 직접 체이닝.

핵심 파일:
- `shared/types.ts` — 계약. `shared/validators.ts` — verifyQuote/validateEntry/validateTailored.
- `backend/src/ports.ts` — 모든 외부 의존 인터페이스(StorePort/BlobPort/BedrockPort/HttpPort/JobInvoker).
- `backend/src/collect/*` — github·web·notion·file 어댑터 + collect.
- `backend/src/pipeline/*` — extract·consolidate·master·refresh·tailor (순수 함수).
- `backend/src/worker/worker.ts` — runCollect·runPipeline·runTailor (오케스트레이션).
- `backend/src/{api,collector,pipeline}/handler.ts` — Lambda 엔트리(순수 핸들러 + AWS 엔트리 주석 TODO).
- `backend/src/adapters/memory.ts` — 인메모리 어댑터(테스트/로컬).
- `frontend/src/` — Vite React. api.ts(목↔실제 전환), evidence/(근거추적), screens/(5화면).

## 결정론적 id (중요한 설계 포인트)

refresh("다시 불러오기") 시 활동 정체성 유지를 위해 id 를 내용 기반으로 만듦:
- evidence id = `contentId('evd', artifactId, field, quote)`
- activityId = `contentId('act', ...정렬된 evidenceIds)`
- 덕분에 내용 안 바뀐 출처는 재추출 스킵, lockedFields(사용자 수정 칸) 보존이 됨.

## tech.md 금지 목록 (제안 시 거절)

Step Functions, Cognito, WebSocket, Textract, 헤드리스 브라우저, 벡터 DB, ORM.
새 AWS 서비스·새 npm 의존성은 추가 전 확인.

## AWS 실연동 — 남은 일 (자격증명·전제 후)

전제: 리전 **us-east-1**, Bedrock Claude 모델 접근, GitHub·Notion 토큰. (수업용 계정, 콘솔 로그인만 가능 — CLI 제한 가능성)

1. **포트 구현체** `backend/src/adapters/aws/`:
   - DynamoStore(`@aws-sdk/lib-dynamodb`), S3Blob(`client-s3`+presigner), BedrockConverse(`client-bedrock-runtime`, Converse+toolConfig), LambdaJobInvoker(`client-lambda`, InvocationType=Event), FetchHttp(내장 fetch), Readability(`@mozilla/readability`+`linkedom`).
   - ⚠ 새 npm 의존성 → 추가 전 확인 필요.
2. **각 핸들러의 `buildXxxDeps()` + `export const handler`** 채우기.
3. **SAM `template.yaml`** (한 파일): API GW HTTP API + Lambda 3개(Collector/Pipeline 15분·비동기) + DynamoDB 단일테이블(PK `PF#{portfolioId}`) + S3 + IAM(invoke/Bedrock/Dynamo/S3) + 프론트 S3+CloudFront.
4. **환경변수 이름(코드 고정)**: `BEDROCK_MODEL_ID`, `EXTRACT_CONCURRENCY`(기본3), `GITHUB_TOKEN`, `NOTION_TOKEN`, `RAWTEXT_SPILL_LIMIT`(기본40000). 팀원 추가: 테이블명·버킷명·Collector/Pipeline Lambda 이름.
5. **프론트 연결**: `VITE_USE_MOCK=false VITE_API_BASE=<API_URL>` 로 재빌드. API CORS 에 CloudFront 도메인 허용.

콘솔 기준 가이드: `docs/aws-prereqs-checklist.md`, `docs/deploy-frontend-console.md`.
현황 상세: `backend/IMPLEMENTATION_STATUS.md`, `frontend/IMPLEMENTATION_STATUS.md`.

## 아직 미결정 (후속 논의)

design.md 기준 후속 제안들 — 아직 반영 안 함:
1. **날짜 3종 구분**: 수집일(`Artifact.fetchedAt`)·게시일(`meta.publishedAt`)·활동일(`Period`). 셋 다 타입에 존재하나 명확화 여부 미정.
2. **Experience Memory / 게시(publish)**: 확인된 경험 저장소 재명명, 공개 URL 발행 — design.md "만들지 않는 것"에 웹발행 포함이라 범위 밖.
3. **부족 정보 질문 + 사용자 검수** 단계: 미구현(신규 기능 후보).
4. 포트폴리오(2차 맞춤본) 기능을 유지할지 재검토 언급 있었음.

## 로컬 실행

```bash
# 각 패키지
cd shared   && npm install && npm test      # 11
cd backend  && npm install && npm test      # 42
cd frontend && npm install && npm test      # 5
cd frontend && npm run dev                  # 브라우저에서 목 데이터로 전 흐름 (http://localhost:5173)
```

## 담당 분업 (현재)

- 팀원 A: AWS Lambda 어댑터·배포 코드 작성 중.
- 사용자(문서 작성자): AWS 콘솔 준비(Bedrock 액세스·토큰·프론트 S3+CloudFront 배포). us-east-1, 콘솔만.

## 주의

- `shared/types.ts` 정의는 design.md 5장 원문 그대로 + export 만 추가. 필드/구조 변경 시 팀 합의.
- 테스트는 tsc + node:test(backend/shared), vitest(frontend). 새 코드엔 테스트 동반.
- 저장소는 PUBLIC. 시크릿 커밋 금지(.env·토큰). 현재 코드엔 시크릿 없음.
