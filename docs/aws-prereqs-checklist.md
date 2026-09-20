# AWS 사전 준비 체크리스트 (콘솔 기준)

_리전: **us-east-1 (버지니아 북부)** · 콘솔 클릭만으로 진행 (CLI 불필요)_

담당: 인프라/배포 준비. 팀원의 Lambda 코드와 겹치지 않는 영역이다.

---

## 1. Bedrock Claude 모델 액세스 (⚠ 최우선 — 승인 대기 가능)

1. AWS 콘솔 오른쪽 위 리전이 **N. Virginia (us-east-1)** 인지 확인.
2. 검색창에 **Bedrock** → 서비스 진입.
3. 왼쪽 메뉴 **Model access** (또는 "Model catalog" → access).
4. **Manage model access / Enable specific models** 클릭.
5. **Anthropic** 의 Claude 모델 체크 → **Request/Save**.
6. 상태가 **Access granted** 가 될 때까지 대기 (즉시 or 몇 분).
7. 쓸 모델의 **Model ID** 를 적어둔다 → 이게 Lambda 의 `BEDROCK_MODEL_ID`.
   - 예: `anthropic.claude-3-5-sonnet-20240620-v1:0` (콘솔에 표시되는 정확한 ID 사용)

> 안 되면: 수업 계정이 Bedrock 을 막았을 수 있음 → 담당 조교/강사에게 "us-east-1 Bedrock Claude model access" 요청.

## 2. Bedrock 호출 한도 확인

- Bedrock → (콘솔) 또는 Service Quotas 에서 분당 요청 한도 확인.
- 낮으면 Lambda 환경변수 **`EXTRACT_CONCURRENCY=2`** 로 (기본 3).

## 3. GitHub 토큰 (AWS 밖, 지금 바로)

1. github.com → 우상단 프로필 → **Settings**.
2. 맨 아래 **Developer settings** → **Personal access tokens** → **Tokens (classic)** 또는 Fine-grained.
3. **Generate new token** → 권한: 공개 저장소만 읽으면 `public_repo` (또는 fine-grained: Contents read).
4. 생성된 토큰 문자열을 안전하게 보관 → Lambda 의 `GITHUB_TOKEN`.

> 없어도 동작하지만 비인증은 시간당 한도가 낮다(문서 6장).

## 4. Notion 통합 토큰 (AWS 밖, 지금 바로)

1. notion.so/my-integrations → **New integration**.
2. 이름 지정, 연결할 워크스페이스 선택 → 생성.
3. **Internal Integration Secret** 복사 → Lambda 의 `NOTION_TOKEN`.
4. ⚠ 데모로 읽을 **노션 페이지를 그 통합에 공유** (페이지 우상단 ⋯ → Connections → 통합 추가). 이거 안 하면 API 가 페이지를 못 읽음.

## 5. 시크릿 저장 위치 결정 (팀원과 접점)

토큰·모델ID 를 어디 둘지 정한다. 콘솔로 가능:

- **AWS Systems Manager → Parameter Store** (무료, 간단, 권장)
  1. 검색 **Systems Manager** → 왼쪽 **Parameter Store** → **Create parameter**.
  2. 이름 예: `/kiroton/BEDROCK_MODEL_ID`, `/kiroton/GITHUB_TOKEN`, `/kiroton/NOTION_TOKEN`
  3. 토큰류는 **SecureString** 타입으로.
  4. 팀원이 Lambda 에서 이 파라미터를 읽거나, Lambda 환경변수로 복사.

> 팀원과 **환경변수 이름만** 맞추면 됨 (아래 §6). 값 저장 방식은 자유.

## 6. 환경변수 이름 (코드에 이미 고정 — 팀원과 공유)

Lambda 가 읽어야 하는 이름. `backend/src/ports.ts` 의 `Deps.env` 기준.

| 이름 | 필수 | 기본/예시 | 쓰는 곳 |
|---|---|---|---|
| `BEDROCK_MODEL_ID` | ✅ | `anthropic.claude-...` | Pipeline Lambda |
| `EXTRACT_CONCURRENCY` | | `3` (quota 낮으면 `2`) | Pipeline Lambda |
| `GITHUB_TOKEN` | | (없으면 공개만) | Collector Lambda |
| `NOTION_TOKEN` | | (없으면 노션 비활성) | Collector Lambda |
| `RAWTEXT_SPILL_LIMIT` | | `40000` | Collector Lambda |

팀원 쪽에서 **추가로** 정할 이름 (아직 코드에 없음, `buildXxxDeps()` 에서 읽음):
- DynamoDB 테이블명, S3 버킷명, Collector/Pipeline Lambda 이름(또는 ARN — API 가 invoke 대상)

## 순서 요약

1. Bedrock 모델 액세스 신청 (지금 — 대기 있을 수 있음)
2. GitHub · Notion 토큰 발급 (지금)
3. 프론트 S3 + CloudFront 배포 → `docs/deploy-frontend-console.md`
4. 토큰·모델ID Parameter Store 저장 → 팀원에게 이름 공유
