# 02-pipeline-master — tasks

의존 관계를 명시한다. 서로 의존하지 않는 태스크는 병렬로 진행할 수 있다.
운영 규칙: **태스크 1번은 가짜 데이터로 끝에서 끝까지 한 번 통과**시킨다.

## T1. (필수 먼저) 가짜 데이터로 end-to-end 통과 — 의존: 없음

- fixtures/ Artifact 샘플 4개를 하드코딩된 가짜 Evidence로 매핑해, extract→consolidate→compose 전체를 한 번 관통시킨다.
- Bedrock 대신 고정 스텁을 주입한다. 결과 MasterOutput이 `validateEntry`를 통과하는지 확인한다.
- 산출물: `pnpm test` 한 번으로 파이프라인 골격이 도는 것.

## T2. mapWithConcurrency 유틸 + 단위 테스트 — 의존: 없음

- limit개씩 동시 실행. 순서 보존, 에러 전파 검증.

## T3. extractEvidence + Bedrock tool use 스키마 — 의존: T1

- Converse API tool use. `{ evidences: [{ field, claim, quote }] }` 스키마.
- verifyQuote로 폐기 필터. 폐기 수 반환.
- Bedrock 모킹 단위 테스트.

## T4. consolidateActivities (활동 묶기 + 기간 추론) — 의존: T1

- Evidence → activityId 부여, Period.inferred 표시.
- "N개 링크가 하나의 활동으로" 이벤트 생성.
- 단위 테스트(모킹).

## T5. composeMaster (표준 폼 채우기 + 정렬) — 의존: T3, T4

- ActivityEntry 채우기, period.start 정렬, 없는 칸 null.
- validateEntry 강제: 1회 재시도 후 위반 문장 삭제.
- 단위 테스트(모킹).

## T6. 갱신(refresh) 경로 — 의존: T3, T5

- contentHash 변경분만 재추출. 3·4단계 전체 재실행. lockedFields 보존.
- 단위 테스트.

## T7. 오케스트레이션 + Run.events 배선 — 의존: T5

- DynamoDB 읽기/쓰기, 단계별 한국어 이벤트 append, status 전이.

## T8. 통합 테스트 스크립트(실제 Bedrock) — 의존: T3, T5

- 단위 테스트와 분리. CI 제외. 당일 리허설용.

## 병렬 가능성

- T2, T3, T4는 T1 이후 병렬.
- T5는 T3·T4 완료 후. T6·T7은 T5 이후 병렬. T8은 T3·T5 이후.
