# 04-frontend — design

## 개요

Vite + React SPA. `shared/types.ts`를 import해 타입을 공유한다. 백엔드 완성 전에는 가짜 JSON 픽스처로 화면을 먼저 그린다(문서 5인 분업안 E: 가짜 JSON으로 화면 3과 5).

## 라우팅 / 화면

| 경로 | 화면 |
|---|---|
| `/` | 1 등록 |
| `/p/{id}/run/{runId}` | 2 정리 중 |
| `/p/{id}` | 3 마스터 타임라인 |
| `/p/{id}/tailor` | 4 직무 맞춤 만들기 |
| `/p/{id}/o/{outputId}` | 5 맞춤 포트폴리오 |

## API 클라이언트

- `shared/types.ts` 타입으로 응답을 파싱하는 얇은 fetch 래퍼.
- 폴링 훅 `useRunPolling(runId)`: 1.5초 간격, status가 done/failed면 정지.
- 초기에는 `fixtures/*.json`을 반환하는 목 클라이언트로 시작(환경 플래그로 전환).

## 핵심 컴포넌트

- `TimelineCard(entry)`: 폼 카드. null 칸 회색, inferred 기간 "추정" 꼬리표.
- `SentenceView(sentence)`: 클릭 시 evidenceIds로 `EvidencePanel` 오픈(근거 추적, 마스터·맞춤 공통 재사용).
- `EvidencePanel(evidenceIds)`: QuoteRef 원문 구절 표시.
- `SourceDropzone`: presigned URL 업로드.
- `CompetencyTags`, `GapReport`: 화면 5 역량·공백 리포트.
- `StaleBanner`: 마스터가 더 새로우면 "원본이 바뀜, 다시 만들기".

## PDF 내보내기

- 서버 렌더 없이 `window.print()` + `@media print` CSS. 화면 5 전용 인쇄 레이아웃.

## 테스트 전략

- 목 데이터로 화면 3(마스터)과 5(맞춤)가 그려지는지(첫 산출물).
- SentenceView 클릭 → EvidencePanel 오픈 상호작용.
- 폴링 훅: running→done 전이 시 정지.
- 브라우저 검증(가능 시): 파이프라인의 @playwright로 렌더 스냅샷.
