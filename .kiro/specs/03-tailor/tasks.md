# 03-tailor — tasks

운영 규칙: **태스크 1번은 가짜 데이터로 끝에서 끝까지 한 번 통과**시킨다.

## T1. (필수 먼저) 샘플 마스터 + "백엔드 개발자" → TailoredOutput end-to-end — 의존: 없음

- 고정 Competency/intro/entries를 반환하는 스텁으로 composeTailored를 관통.
- 결과가 `validateTailored`를 통과하는지 확인. (문서 5인 분업안 D의 첫 산출물)

## T2. interpretRole (역량 5~8개) — 의존: T1

- 직무명/JD → Competency[]. Bedrock 모킹 단위 테스트.

## T3. rankActivities (관련도순 신호) — 의존: T1

- 활동별 관련도 점수. AI 추천 체크용. 단위 테스트.

## T4. retell (재서술) + validateTailored 강제 — 의존: T2, T3

- 선택 활동을 직무 언어로 재서술. allowedEvidenceIds 밖 사용 금지.
- 위반 시 1회 재시도 후 문장 삭제. 단위 테스트(모킹).

## T5. intro 요약 — 의존: T4

- 선택 근거만으로 3~4문장. (retell에 포함 가능)

## T6. 공백 리포트 — 의존: T2

- 근거 없는 역량을 빈 evidenceIds로. 단위 테스트.

## T7. basedOnMasterAt + 원본 변경 신호 — 의존: T1

- 마스터 시각 기록. (배너 렌더는 04)

## T8. API 배선 (outputs) — 의존: T4

- `POST /portfolios/{id}/outputs`, `GET /portfolios/{id}/outputs`, `GET /outputs/{outputId}`.

## 병렬 가능성

- T2, T3, T7은 T1 이후 병렬.
- T4는 T2·T3 이후. T5·T6·T8은 그 후 병렬.
