# tech.md

## 언어

- TypeScript 전체.
- 백엔드: Node.js Lambda.
- 프론트: Vite + React.

## 인프라

AWS SAM `template.yaml` 하나로 전체 인프라를 기술한다.

- **API Gateway HTTP API** — 프론트의 요청 진입점.
- **API Lambda** — CRUD와 실행 접수. 응답 제한(약 30초)을 피하려고 접수와 실행을 나눈다.
- **Worker Lambda** — 파이프라인 1~5단계. 비동기 호출, 제한 시간 15분. 단계가 직렬이라 함수 하나 안에서 순서대로 돌린다.
- **DynamoDB 단일 테이블** — 온디맨드. PK는 `PF#{portfolioId}`. 포트폴리오 하나를 Query 한 번으로 읽는다.
- **S3** — 업로드 파일과 큰 원문. presigned URL로 브라우저에서 직접 업로드(Lambda 요청 크기 제한 회피). 프론트 정적 호스팅도 S3 + CloudFront.
- **Bedrock Converse API** — Claude 모델. PDF·이미지는 document, image 블록으로 그대로 넘긴다.

## AI 호출 규칙

- 모든 AI 호출은 반드시 tool use로 JSON 스키마를 강제한다. 자유 텍스트를 파싱하지 않는다.
- 인용문의 위치(start, end)는 AI가 아니라 코드가 `indexOf`로 계산한다.
- 2단계 추출은 출처별 독립이라 Worker 안에서 Promise.all 병렬(동시 3~4개), Bedrock 호출 한도에 맞춰 동시 수를 제한한다.

## 금지

- Step Functions
- Cognito
- WebSocket
- Textract
- 헤드리스 브라우저
- 벡터 DB
- ORM

## 변경 규칙

- 새 AWS 서비스나 새 npm 의존성을 추가하기 전에 반드시 먼저 물어본다.
