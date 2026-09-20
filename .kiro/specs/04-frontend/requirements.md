# 04-frontend — requirements

## 범위

- **입력**: API 응답(design.md 7장 엔드포인트)과 `shared/types.ts` 타입. 초기에는 가짜 JSON.
- **출력**: 화면 5개(등록, 정리 중, 마스터 타임라인, 직무 맞춤 만들기, 맞춤 포트폴리오)를 렌더하는 Vite + React SPA.
- **대상**: `docs/design.md` 7장 화면 5개, 근거 추적(추가 3), 브라우저 인쇄 PDF.
- **비범위**: 백엔드 로직(01~03). 프론트는 가짜 데이터로 먼저 진행한다.

## 용어

- 모든 데이터 타입은 `shared/types.ts`에서 import한다.

## 요구사항 (EARS)

### R1. 화면 1 — 등록

- THE 시스템 SHALL 입력창 하나와 파일 끌어다 놓기 영역을 제공한다.
- THE 시스템 SHALL 등록된 출처 목록과 "정리하기" 버튼을 보여준다.
- WHEN 파일을 놓으면, THE 시스템 SHALL presigned URL로 S3에 직접 업로드한다.

### R2. 화면 2 — 정리 중

- WHILE Run.status가 running인 동안, THE 시스템 SHALL 1.5초마다 `GET /runs/{runId}`를 폴링한다.
- THE 시스템 SHALL Run.events를 시간순으로 출력한다("3개 링크가 하나의 활동으로 합쳐졌습니다" 등).

### R3. 화면 3 — 마스터 타임라인

- THE 시스템 SHALL ActivityEntry를 세로 타임라인 폼 카드로 렌더한다.
- THE 시스템 SHALL 값이 null인 칸을 회색으로, `period.inferred`가 true인 기간에 "추정" 꼬리표를 붙인다.
- WHEN 사용자가 문장을 클릭하면, THE 시스템 SHALL 그 문장의 evidenceIds로 원문 인용 패널을 연다.
- THE 시스템 SHALL "다시 불러오기", "직무 맞춤 만들기" 버튼을 제공한다.

### R4. 근거 추적

- THE 시스템 SHALL 모든 Sentence(마스터·맞춤 공통)에 대해 클릭 시 QuoteRef의 원문 구절을 보여준다.

### R5. 화면 4 — 직무 맞춤 만들기

- THE 시스템 SHALL 직무명 입력, JD 붙여넣기(선택), 활동 체크리스트, "만들기" 버튼을 제공한다.
- THE 시스템 SHALL AI 추천 체크(관련도순)를 미리 반영한다.

### R6. 화면 5 — 맞춤 포트폴리오

- THE 시스템 SHALL 상단 자기소개(intro), 역량 태그, 관련도순 활동, 공백 리포트를 렌더한다.
- WHEN 마스터가 basedOnMasterAt보다 새로우면, THE 시스템 SHALL "원본이 바뀜, 다시 만들기" 배너를 보여준다.
- THE 시스템 SHALL 브라우저 인쇄(window.print + 인쇄용 CSS)로 PDF 내보내기를 제공한다.

### R7. 직접 수정과 잠금

- WHEN 사용자가 칸을 직접 고치면, THE 시스템 SHALL `PATCH .../entries/{activityId}`로 저장하고 그 칸을 lockedFields에 추가한다.
- THE 시스템 SHALL "다시 불러오기"가 잠긴 칸을 건드리지 않음을 전제로 렌더한다.
