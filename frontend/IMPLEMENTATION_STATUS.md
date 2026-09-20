# 프론트엔드 구현 현황과 S3 배포 경계

_작성: 2026-09-20 · 대상: frontend/_

## 요약

Vite + React SPA로 **화면 5개 전부 구현**했다. AWS 없이 가짜 JSON + 목 API로 브라우저에서 전 흐름이 돈다.
확정된 UI: **상단 링크 입력 → 세로 시간순 활동 타임라인(제목=키워드) → 활동 클릭 펼침 → 문장 클릭 시 원문 구절(QuoteRef)까지 추적.**

- 테스트: vitest **5개 통과** (화면 3·5 렌더, 추정 꼬리표, 근거 추적 클릭, T9 편집+잠금).
- typecheck 클린, `npm run build` 성공 → `dist/`가 S3 정적 호스팅 산출물.
- shared/types.ts를 `@shared` alias로 공유 (백엔드와 동일 타입 계약).

## 화면 (design.md 7장)

| 경로 | 화면 | 상태 |
|---|---|---|
| `/` | 1 등록 (링크 입력 + 파일 드롭 + 출처 목록 + 정리하기) | ✓ |
| `/p/:id/run/:runId` | 2 정리 중 (1.5초 폴링, events 시간순) | ✓ |
| `/p/:id` | 3 마스터 타임라인 (활동 카드, 추정 꼬리표, 근거 추적, 직접 수정+잠금) | ✓ |
| `/p/:id/tailor` | 4 직무 맞춤 만들기 (직무/JD, 활동 체크리스트) | ✓ |
| `/p/:id/o/:outputId` | 5 맞춤 포트폴리오 (intro, 역량, 공백 리포트, 배너, PDF 인쇄) | ✓ |

## 핵심: 근거 추적 (문서 차별점)

- 모든 문장은 `SentenceView` → 클릭 시 `EvidencePanel`이 `evidenceIds`로 원문 구절(QuoteRef)을 띄운다.
- 마스터·맞춤 화면이 같은 컴포넌트를 공유 → "AI가 부풀린 경력"을 화면에서 원문으로 검증 가능.

## 목 ↔ 실제 API 전환

`src/api.ts`가 `Api` 인터페이스 하나로 추상화. 환경변수로 전환한다.

```bash
# 목(기본): AWS 없이 fixtures 로 동작
npm run dev

# 실제 백엔드 연결
VITE_USE_MOCK=false VITE_API_BASE=https://<api-gateway-url> npm run build
```

- `createMockApi()`: fixtures 반환 (지금 데모).
- `createHttpApi(baseUrl)`: design.md 7장 엔드포인트로 fetch. 백엔드 API Lambda가 배포되면 URL만 넣으면 된다.

## S3 정적 호스팅 배포 경계 (자격증명 받은 뒤)

지금 `npm run build` 산출물(`dist/`)이 그대로 올라간다. 남은 것:

1. **빌드**: `VITE_USE_MOCK=false VITE_API_BASE=<url>`로 실제 API를 가리켜 빌드.
2. **S3 버킷**: 정적 웹 호스팅용 버킷 (SAM template.yaml에 정의).
3. **CloudFront**: SPA라 라우팅이 클라이언트 사이드 → 403/404를 `index.html`로 리다이렉트 설정 필요 (react-router BrowserRouter).
4. **업로드**: `aws s3 sync dist/ s3://<bucket>` + CloudFront 무효화.
5. **CORS**: API Gateway에서 CloudFront 도메인 허용.

> 배포는 backend의 SAM template.yaml에 프론트 호스팅(S3+CloudFront)을 함께 넣는 것을 권장 (tech.md: template.yaml 하나).

## 미해결 / 다음

- **파일 업로드 실동작**: 지금 목에서는 presigned PUT 업로드를 생략. 실제 백엔드 연결 시 `addSource(file)` 후 uploadUrl로 PUT 구현 필요.
- **맞춤본 생성 폴링**: 목은 `createOutput`이 outputId를 즉시 반환. 실제 백엔드는 202 runId → 폴링 후 이동으로 바꿔야 함(RunScreen 재사용 가능).
- **원문 조회 엔드포인트**: 근거 패널의 원문(Artifact)은 목에서 `getArtifacts`로 주지만, 실제 백엔드엔 해당 엔드포인트가 없음. `GET /portfolios/{id}/artifacts` 추가 또는 getPortfolio 응답에 포함 필요.
- **npm audit**: 7건(esbuild/vitest는 dev 전용이라 프로덕션 번들 무관, react-router-dom만 런타임). `audit fix --force`는 react-router major 상승으로 breaking → 하지 않음. 배포 전 재평가.

## 실행

```bash
cd frontend && npm install
npm run dev        # 브라우저에서 목 데이터로 전 흐름 확인
npm test           # vitest 5개
npm run build      # dist/ 생성 (S3 호스팅용)
```
