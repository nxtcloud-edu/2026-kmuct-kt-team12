# 01-collect — tasks

운영 규칙: **태스크 1번은 가짜 데이터로 끝에서 끝까지 한 번 통과**시킨다.

## T1. (필수 먼저) 가짜 URL → Artifact 저장 end-to-end — 의존: 없음

- 스텁 어댑터(고정 rawText 반환)로 collect()를 관통시켜, contentHash 계산과 DynamoDB 저장(로컬 모킹)까지 한 번 통과.
- 산출물: 깃허브 URL 1개가 Artifact로 저장되는 경로(문서 5인 분업안 B의 첫 산출물).

## T2. 공통 수집 계층 (해시, spill, 저장) — 의존: T1

- sha256 contentHash, 4만 자 spill→S3, DynamoDB put. 단위 테스트.

## T3. fetchGithub 어댑터 — 의존: 없음 (T1 이후 병렬)

- REST API 모킹. README/languages/commit range → rawText/meta. 단위 테스트.

## T4. fetchWeb 어댑터 (Readability) — 의존: 없음 (T1 이후 병렬)

- 고정 HTML → 본문 추출. 단위 테스트.

## T5. fetchNotion 어댑터 — 의존: 없음 (T1 이후 병렬)

- 공식 API 모킹 + 통합 토큰. 단위 테스트. (해커톤 "가능하면" 등급)

## T6. 파일 업로드 (presigned URL) — 의존: T2

- `POST /sources` (kind=file) presigned PUT 발급. s3Key 보관.

## T7. API 배선 (sources CRUD) — 의존: T2

- POST/DELETE sources, POST portfolios. GET portfolios의 Source[].

## T8. 실패 격리 + Run.events — 의존: T2

- 출처 하나 실패가 전체를 멈추지 않게. 실패 이벤트 기록.

## 병렬 가능성

- T3, T4, T5는 T1 이후 서로 독립 병렬.
- T6, T7, T8은 T2 이후 병렬.
