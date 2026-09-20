# AWS 콘솔 설정 가이드 — 포트폴리오 생성기

_사람이 AWS 콘솔에서 직접 해야 할 일. 인프라 정의 파일(SAM/CDK/Terraform)은 없다. 전부 콘솔 클릭._

> 이 문서는 재설계된 구조(Lambda 3개 + DynamoDB 단일 테이블 + S3 + API Gateway HTTP API + Amplify) 기준이다.
> `docs/aws-prereqs-checklist.md`, `docs/deploy-frontend-console.md`, `docs/dynamodb-schema.md` 는 이전 설계(GSI, S3+CloudFront) 기준이므로 참고만 하고, 충돌하면 이 문서를 따른다.

---

## 0. 리전 확인

- 콘솔 오른쪽 위 리전이 **미국 동부(버지니아 북부) us-east-1** 인지 확인한다.
- 코드가 리전을 `us-east-1` 로 고정하고 있으므로, 다른 리전에 만든 리소스는 코드가 찾지 못한다.
- 아래 모든 리소스(DynamoDB, S3, Lambda, API Gateway, SQS, Amplify)를 같은 리전에 만든다.

## 1. 로컬에서 zip 만들기 (콘솔 작업 전)

```powershell
# backend: dist/api.zip, dist/collector.zip, dist/ai-worker.zip
cd backend
& "$env:ProgramFiles\nodejs\npm.cmd" install
& "$env:ProgramFiles\nodejs\npm.cmd" run build

# frontend: site.zip (VITE_API_BASE 는 빌드 시점에 박히므로 API 주소가 정해진 뒤 빌드)
cd ../frontend
& "$env:ProgramFiles\nodejs\npm.cmd" install
$env:VITE_USE_MOCK = "false"
$env:VITE_API_BASE = "https://<api-id>.execute-api.us-east-1.amazonaws.com"
& "$env:ProgramFiles\nodejs\npm.cmd" run build
& "$env:ProgramFiles\nodejs\npm.cmd" run package
```

- 각 백엔드 zip 은 루트에 `index.mjs` 하나만 들어 있다. 핸들러 이름은 `index.handler`.
- `site.zip` 은 루트에 `index.html` 과 `assets/` 가 있다.

## 2. DynamoDB 테이블

콘솔 → DynamoDB → 테이블 생성.

| 항목 | 값 |
|---|---|
| 테이블 이름 | 자유 (예: `portfolio-generator`). 이 값을 Lambda 환경변수 `TABLE_NAME` 에 넣는다 |
| 파티션 키 | `PK` (문자열) |
| 정렬 키 | `SK` (문자열) |
| 용량 모드 | **온디맨드** |
| GSI | 없음 (필요 없음) |

키 구조(참고): `PK = SES#{sessionId}`, `SK = META | REC#… | KW#… | EXP#… | Q#… | JOB#… | SITE`.

## 3. S3 버킷

콘솔 → S3 → 버킷 만들기.

| 항목 | 값 |
|---|---|
| 버킷 이름 | **반드시 `{username}` 으로 시작** (예: `{username}-portfolio-sites`). 계정 정책상 다른 이름은 생성이 거부될 수 있다 |
| 리전 | us-east-1 |
| 퍼블릭 액세스 차단 | **모두 차단 유지** (기본값 그대로). 사이트 HTML 은 api Lambda 가 `/sites/{sessionId}` 로 읽어서 내려주므로 버킷을 공개할 필요가 없다 |
| 버전 관리/암호화 | 기본값 |

- 이 버킷 이름을 api 와 ai-worker 의 환경변수 `SITE_BUCKET` 에 넣는다.
- ai-worker 가 `sites/{sessionId}/index.html` 키로 업로드한다. 폴더를 미리 만들 필요는 없다.

## 4. Lambda 함수 3개

콘솔 → Lambda → 함수 생성 → "새로 작성".

공통:
- 런타임 **Node.js 20.x** (또는 그 이상), 아키텍처 x86_64.
- 실행 역할: **기존 역할 사용 → `SafeRole`** 선택. (새 역할 생성 금지. 권한이 부족하면 주최 측에 요청.)
- 생성 후 "코드" 탭 → "업로드 → .zip 파일" 로 zip 업로드.
- "런타임 설정" → 핸들러를 **`index.handler`** 로 (기본값이 `index.handler` 이면 그대로).
- "구성 → 일반 구성" 에서 제한 시간과 메모리를 **반드시** 바꾼다(기본 3초는 전부 타임아웃).

| 함수 | zip | 제한 시간 | 메모리 | 비동기 호출 재시도 |
|---|---|---|---|---|
| `api` | `backend/dist/api.zip` | **29초** | 512 MB | 해당 없음(동기) |
| `collector` | `backend/dist/collector.zip` | **5분** | 512 MB | **0** |
| `ai-worker` | `backend/dist/ai-worker.zip` | **15분** | 1024 MB | **0** |

- 비동기 재시도 0 설정: 각 함수 → "구성 → 비동기 호출 → 편집 → 재시도 횟수 0". (재시도가 남아 있으면 실패한 작업이 두 번 돌아 Bedrock 비용이 늘고 이벤트가 중복된다. 코드에도 중복 실행 방지가 있지만 콘솔 설정도 맞춰 둔다.)
- api 제한 시간을 29초로 두는 이유: API Gateway HTTP API 통합 최대 시간이 30초이므로 그보다 짧게 잡아 Lambda 쪽 오류 메시지를 볼 수 있게 한다.

### 4-1. 환경변수 (구성 → 환경 변수 → 편집)

**api**

| 키 | 값 | 비고 |
|---|---|---|
| `TABLE_NAME` | DynamoDB 테이블 이름 | 필수 |
| `SITE_BUCKET` | S3 버킷 이름 | 필수. `/sites/{sessionId}` 응답용 |
| `DISPATCH_MODE` | `invoke` 또는 `sqs` | 기본 `invoke`. 6장 참고 |
| `COLLECTOR_FN` | collector Lambda 함수 이름 | `DISPATCH_MODE=invoke` 일 때 필수 |
| `AI_WORKER_FN` | ai-worker Lambda 함수 이름 | `DISPATCH_MODE=invoke` 일 때 필수 |
| `COLLECTOR_QUEUE_URL` | collector 큐 URL | `DISPATCH_MODE=sqs` 일 때 필수 |
| `AI_WORKER_QUEUE_URL` | ai-worker 큐 URL | `DISPATCH_MODE=sqs` 일 때 필수 |

**collector**

| 키 | 값 | 비고 |
|---|---|---|
| `TABLE_NAME` | DynamoDB 테이블 이름 | 필수 |
| `MAX_REPOS` | 예 `20` | 선택. GitHub 저장소 최대 수. 기본 20 |
| `MAX_POSTS` | 예 `20` | 선택. 티스토리 글 최대 수. 기본 20 |
| `MAX_PAGES` | 예 `20` | 선택. Notion 페이지 최대 수. 기본 20 |

**ai-worker**

| 키 | 값 | 비고 |
|---|---|---|
| `TABLE_NAME` | DynamoDB 테이블 이름 | 필수 |
| `SITE_BUCKET` | S3 버킷 이름 | 필수 |
| `BEDROCK_MODEL_ID` | **`us.` 로 시작하는 추론 프로필 ID** (예: `us.anthropic.claude-3-5-sonnet-20241022-v2:0`) | 필수. Bedrock 콘솔 → "교차 리전 추론(Cross-region inference)" 에서 복사. `anthropic.` 으로 시작하는 기본 모델 ID 를 넣으면 오류 |
| `AI_CONCURRENCY` | 예 `3` | 선택. 기록별 Bedrock 병렬 호출 수. 기본 3. 스로틀링이 잦으면 2 로 |
| `API_PUBLIC_BASE` | API Gateway 호출 URL (예: `https://xxxx.execute-api.us-east-1.amazonaws.com`) | 필수. 사이트 결과 URL(`{API_PUBLIC_BASE}/sites/{sessionId}`) 조립용 |
| `SITE_PUBLIC_BASE` | (선택) 버킷을 직접 공개했을 때의 기본 URL | 비워 두면 API 경유 URL 사용. 퍼블릭 액세스 차단을 유지하는 한 비워 둔다 |

- 환경변수가 빠지면 Lambda 가 시작 시 `환경 변수 XXX 가 설정되지 않았습니다` 오류를 낸다(CloudWatch 로그에서 확인).

### 4-2. Bedrock 모델 액세스

- 콘솔 → Bedrock → 모델 액세스 에서 Anthropic Claude 모델이 "액세스 허용" 상태인지 확인.
- 코드는 Converse API + 도구 호출(toolConfig) 을 쓰므로 도구 호출을 지원하는 Claude 3 이상 모델을 고른다.
- `SafeRole` 에 `bedrock:InvokeModel` 권한이 없으면 `AccessDeniedException` 이 난다 → 주최 측에 요청.

## 5. API Gateway (HTTP API)

콘솔 → API Gateway → API 생성 → **HTTP API** (REST API 아님) → 구축.

1. 통합: Lambda → `api` 함수 선택. (통합 추가 시 콘솔이 api Lambda 에 호출 권한을 자동으로 붙인다.)
2. 라우트: **`$default` 하나만** 만든다. 메서드 `ANY`, 경로 `$default`. (라우팅은 Lambda 안의 라우터가 한다. 개별 라우트를 만들 필요 없음.)
3. 스테이지: `$default`, 자동 배포 켬.
4. 생성 후 "호출 URL"(`https://<api-id>.execute-api.us-east-1.amazonaws.com`) 을 복사한다.
   - 프론트 빌드의 `VITE_API_BASE`
   - ai-worker 의 `API_PUBLIC_BASE`
   에 이 값을 넣는다(끝에 `/` 없이).

### 5-1. CORS (API → CORS → 구성)

| 항목 | 값 |
|---|---|
| Access-Control-Allow-Origin | Amplify 앱 주소 (예: `https://main.xxxxxxxx.amplifyapp.com`). 끝에 `/` 없이. 로컬 개발 시 `http://localhost:5173` 추가 |
| Access-Control-Allow-Methods | `GET`, `POST`, `PATCH`, `OPTIONS` |
| Access-Control-Allow-Headers | `content-type` |
| Access-Control-Allow-Credentials | 끔 |

- api Lambda 는 CORS 헤더를 직접 넣지 않는다. API Gateway 의 CORS 설정이 유일한 출처이므로 여기 빠지면 브라우저에서 바로 CORS 오류가 난다.
- Amplify 주소는 Amplify 배포(8장) 후에 알 수 있으므로, Amplify 배포 뒤 다시 와서 Origin 을 추가한다.

## 6. invoke 가 막힌 경우: SQS 대체 경로

기본은 api Lambda 가 `lambda:InvokeFunction` (비동기 Event) 으로 collector / ai-worker 를 깨우는 `DISPATCH_MODE=invoke` 다.
`SafeRole` 에 `lambda:InvokeFunction` 이 없어 `AccessDeniedException` 이 나면 SQS 로 우회한다.

1. 콘솔 → SQS → 대기열 생성 → **표준** 큐 2개.

| 큐 | 가시성 제한 시간 | 소비자 |
|---|---|---|
| `collector-queue` | **6분** (collector 제한시간 5분 + 1분) | collector Lambda |
| `ai-worker-queue` | **16분** (ai-worker 제한시간 15분 + 1분) | ai-worker Lambda |

   - 가시성 제한 시간이 Lambda 제한 시간보다 짧으면 Lambda 트리거 생성 자체가 거부된다.
   - 나머지(보존 기간, DLQ)는 기본값.
2. 각 Lambda → "트리거 추가" → SQS → 해당 큐 선택 → **배치 크기 1** → 활성화.
   (배치 크기 1 이어야 작업 하나가 Lambda 한 번에 대응해 시간 제한 계산이 맞는다.)
3. api Lambda 환경변수 변경:
   - `DISPATCH_MODE=sqs`
   - `COLLECTOR_QUEUE_URL`, `AI_WORKER_QUEUE_URL` 에 각 큐의 URL(`https://sqs.us-east-1.amazonaws.com/…`).
4. 작업 Lambda 코드는 직접 호출 이벤트와 SQS 이벤트(`Records[].body`) 를 모두 처리하므로 zip 을 다시 올릴 필요는 없다.
5. `SafeRole` 에 `sqs:SendMessage`(api) 와 `sqs:ReceiveMessage/DeleteMessage/GetQueueAttributes`(트리거) 권한이 있어야 한다. 이것도 없으면 주최 측에 요청.

## 7. zip 업로드 방법 정리

| 대상 | 콘솔 위치 | 파일 | 확인 사항 |
|---|---|---|---|
| api Lambda | Lambda → 함수 → 코드 → 업로드 → .zip 파일 | `backend/dist/api.zip` | 핸들러 `index.handler` |
| collector Lambda | 같음 | `backend/dist/collector.zip` | 핸들러 `index.handler` |
| ai-worker Lambda | 같음 | `backend/dist/ai-worker.zip` | 핸들러 `index.handler` |
| 프론트 | Amplify → 앱 → 배포 → 드래그 앤 드롭 | `frontend/site.zip` | zip 루트에 `index.html` |

- 코드를 수정했으면 `npm run build` 로 zip 을 다시 만들고 같은 자리에 다시 업로드한다. 환경변수는 유지된다.
- 코드 탭에서 파일 트리에 `index.mjs` 가 루트에 보이면 정상이다. `api/index.mjs` 처럼 하위 폴더에 있으면 zip 을 잘못 만든 것.

## 8. Amplify 수동 배포 (프론트)

콘솔 → AWS Amplify → 새 앱 → **Git 공급자 없이 배포(수동 배포)**.

1. 앱 이름 자유. 환경 이름 `main`(기본).
2. 배포 방법: "드래그 앤 드롭" → `frontend/site.zip` 업로드 → 저장 및 배포.
3. 배포 완료 후 도메인(`https://main.xxxxxxxx.amplifyapp.com`) 을 복사해 5-1 CORS Origin 에 추가한다.
4. 프론트는 HashRouter 를 쓰므로 Amplify 의 리다이렉트(SPA rewrite) 규칙은 필요 없다.

**`VITE_API_BASE` 주의**: 프론트가 부르는 API 주소는 **빌드 시점에 JS 에 박힌다.** API Gateway 주소가 바뀌거나 처음 정해지면 반드시 다시 빌드·패키징·재업로드한다.

```powershell
cd frontend
$env:VITE_USE_MOCK = "false"
$env:VITE_API_BASE = "https://<api-id>.execute-api.us-east-1.amazonaws.com"
& "$env:ProgramFiles\nodejs\npm.cmd" run build
& "$env:ProgramFiles\nodejs\npm.cmd" run package
```

- `VITE_USE_MOCK` 을 `false` 로 주지 않으면 가짜 API(mock) 로 빌드되어 AWS 를 전혀 호출하지 않는다.
- 배포 후 브라우저 개발자 도구 → 네트워크 탭에서 요청이 `execute-api` 주소로 나가는지 확인한다.

## 9. 순서 요약

1. DynamoDB 테이블 → 2. S3 버킷 → 3. Lambda 3개 생성(SafeRole, 시간/메모리, 재시도 0, 환경변수, zip)
→ 4. API Gateway HTTP API(`$default` → api) 호출 URL 확보 → 5. ai-worker `API_PUBLIC_BASE` 입력
→ 6. 프론트 빌드(`VITE_API_BASE`) + `site.zip` → 7. Amplify 수동 배포 → 8. API Gateway CORS 에 Amplify 도메인 추가
→ (invoke 가 막히면) 9. SQS 큐 2개 + 트리거 + `DISPATCH_MODE=sqs`.

## 10. 증상별 원인

| 증상 (CloudWatch 로그 / 브라우저) | 원인 | 조치 |
|---|---|---|
| `Task timed out after 3.00 seconds` | Lambda 제한 시간을 기본 3초에서 바꾸지 않음 | 구성 → 일반 구성 → 제한 시간을 api 29초 / collector 5분 / ai-worker 15분으로 |
| `AccessDeniedException` (dynamodb / s3 / bedrock / lambda / sqs) | `SafeRole` 에 해당 서비스 권한이 없음 | 주최 측에 권한 추가 요청. `lambda:InvokeFunction` 만 없으면 6장 SQS 우회 |
| `The provided model identifier is invalid` / `ValidationException … model` | `BEDROCK_MODEL_ID` 가 `us.` 로 시작하지 않음(기본 모델 ID 사용) 또는 모델 액세스 미허용 | Bedrock 콘솔의 교차 리전 추론 프로필 ID(`us.anthropic.…`) 로 교체, 모델 액세스 확인 |
| 브라우저 콘솔 `blocked by CORS policy` / `No 'Access-Control-Allow-Origin'` | API Gateway CORS Origin 에 Amplify 도메인이 없음, 또는 `PATCH`/`content-type` 누락 | 5-1 대로 CORS 재설정. Origin 끝에 `/` 를 붙이지 않았는지 확인 |
| `index.handler is undefined or not exported` / `Cannot find module 'index'` | zip 루트에 `index.mjs` 가 없음(하위 폴더에 들어감) 또는 핸들러 이름 오타 | `npm run build` 로 zip 재생성 후 재업로드, 핸들러 `index.handler` 확인 |
| `환경 변수 XXX 가 설정되지 않았습니다` | 해당 Lambda 에 환경변수 누락 | 4-1 표대로 추가 |
| `ThrottlingException` (bedrock) 이 반복 | Bedrock 분당 호출 한도 초과 | ai-worker `AI_CONCURRENCY=2` 또는 `1`. 코드가 1초·3초 백오프로 2회 재시도함 |
| 작업이 계속 `running` 이고 이벤트가 늘지 않음 | api 가 작업 Lambda 를 못 깨움(invoke 거부) 또는 `COLLECTOR_FN`/`AI_WORKER_FN` 이름 오타 | api Lambda 로그 확인. 함수 이름 재확인 또는 6장 SQS 우회 |
| 프론트에서 mock 데이터만 보임 | `VITE_USE_MOCK=false` 없이 빌드 | 8장대로 재빌드 후 site.zip 재업로드 |
| `/sites/{id}` 가 404 | 아직 generate 작업이 완료되지 않았거나 `SITE_BUCKET` 불일치 | 작업 상태 확인, api·ai-worker 의 `SITE_BUCKET` 이 같은지 확인 |
