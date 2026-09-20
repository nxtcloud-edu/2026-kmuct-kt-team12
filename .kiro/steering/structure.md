# structure.md

## 폴더

```
shared/     # 팀 전체가 공유하는 타입 계약과 검증 코드
backend/    # SAM, Lambda (API Lambda, Worker Lambda)
frontend/   # Vite React
docs/       # design.md (이 프로젝트의 단일 설계 근거)
```

## shared/types.ts 규칙

- `shared/types.ts`가 유일한 타입 출처다. 백엔드와 프론트 모두 여기서 import한다.
- 이 파일을 바꿔야 하면 바꾸기 전에 이유를 말하고 확인을 받는다.
- `shared/types.ts`를 고치는 사람은 한 명으로 정한다. 나머지는 변경 요청만 한다.

## API 규칙

- API 경로와 응답 형태는 `docs/design.md` 7장의 표를 그대로 따른다.

## spec 구성

- spec 하나는 `.kiro/specs/<이름>/` 아래 `requirements.md`, `design.md`, `tasks.md` 세 파일이다.
- 네 개의 spec: `01-collect`, `02-pipeline-master`, `03-tailor`, `04-frontend`.
- 각 spec의 tasks 1번은 항상 "가짜 데이터로 끝에서 끝까지 한 번 통과"로 둔다. 통합을 마지막에 몰아서 하지 않는다.

## DynamoDB 항목 네이밍

모든 항목의 PK는 `PF#{portfolioId}`, SK는 다음을 따른다.

| 항목 | SK |
|---|---|
| Source | `SRC#{sourceId}` |
| Artifact | `ART#{artifactId}` |
| Evidence | `EVD#{evidenceId}` |
| MasterOutput | `OUT#MASTER` |
| TailoredOutput | `OUT#TAILORED#{outputId}` |
| Run | `RUN#{runId}` |
