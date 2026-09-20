# 04-frontend — tasks

운영 규칙: **태스크 1번은 가짜 데이터로 끝에서 끝까지 한 번 통과**시킨다.

## T1. (필수 먼저) 가짜 JSON으로 화면 3과 5 렌더 end-to-end — 의존: 없음

- Vite + React 스캐폴딩. shared/types.ts import.
- fixtures MasterOutput/TailoredOutput으로 화면 3(마스터), 5(맞춤)를 렌더. (문서 5인 분업안 E의 첫 산출물)

## T2. API 클라이언트 + 목/실제 전환 — 의존: T1

- 타입 파싱 fetch 래퍼. 환경 플래그로 목↔실제.

## T3. SentenceView + EvidencePanel (근거 추적) — 의존: T1

- 문장 클릭 → 원문 인용. 마스터·맞춤 공통 재사용. 상호작용 테스트.

## T4. 화면 3 — 마스터 타임라인 완성 — 의존: T1

- TimelineCard, null 회색, inferred "추정", 버튼 2개.

## T5. 화면 1 — 등록 + SourceDropzone — 의존: T2

- 입력창, 드롭존, presigned 업로드, 출처 목록, "정리하기".

## T6. 화면 2 — 정리 중 (폴링) — 의존: T2

- useRunPolling 1.5초. events 시간순 출력.

## T7. 화면 4 — 직무 맞춤 만들기 — 의존: T2

- 직무명/JD 입력, 활동 체크리스트(AI 추천 체크), "만들기".

## T8. 화면 5 — 맞춤 포트폴리오 + PDF — 의존: T3

- intro, CompetencyTags, GapReport, StaleBanner, window.print PDF.

## T9. 직접 수정 + 칸 잠금 — 의존: T4

- 칸 편집 → PATCH, lockedFields 반영.

## 병렬 가능성

- T3, T4는 T1 이후 병렬. T2도 T1 이후.
- T5, T6, T7은 T2 이후 병렬. T8은 T3 이후. T9는 T4 이후.
