# 01-collect — design

## 개요

출처 등록과 수집(1단계)을 담당한다. AI를 쓰지 않는다. 출처 종류별 어댑터가 rawText를 만들고, 공통 계층이 해시 계산과 저장을 한다.

## 출처 어댑터

```
fetchGithub(url, deps): { rawText, meta }   // REST API: README, repo info, languages, commit range
fetchWeb(url, deps):    { rawText, meta }   // 페이지 요청 + Readability 본문 추출
fetchNotion(url, deps): { rawText, meta }   // 공식 API + 통합 토큰
prepareFile(source):    { s3Key }           // presigned URL 발급, 원본 S3 보관
```

- 어댑터는 순수 로직 + 주입된 HTTP/SDK 클라이언트(`deps`)로 구성해 테스트 가능하게 한다.
- 블로그는 사이트별 파서를 만들지 않고 Readability 하나로 처리한다.

## 공통 수집 계층

```
collect(source, deps):
  raw = adapterFor(source.kind)(source)
  rawText, rawTextS3Key = spillIfLarge(raw.rawText)   // 4만 자 초과 시 S3
  artifact = { id, sourceId, rawText, rawTextS3Key?, contentHash: sha256(rawText), fetchedAt, meta }
  save(artifact)
```

## API 엔드포인트 (design.md 7장)

- `POST /portfolios` → portfolioId
- `POST /portfolios/{id}/sources` → Source, uploadUrl?
- `DELETE /portfolios/{id}/sources/{sourceId}` → 204
- `GET /portfolios/{id}` 의 Source[] 부분

## DynamoDB

- Source: PK `PF#{portfolioId}`, SK `SRC#{sourceId}`
- Artifact: PK `PF#{portfolioId}`, SK `ART#{artifactId}`

## 파일 업로드 흐름

1. `POST /sources` (kind=file) → Source 생성 + presigned PUT URL 반환
2. 브라우저가 S3에 직접 업로드 (Lambda 6MB 제한 회피)
3. 수집 시 s3Key의 원본을 Bedrock document/image 블록으로 넘긴다(추출은 02에서)

## 실패 격리

- 출처 하나가 실패해도 나머지는 진행. 실패는 Run.events에 기록.

## 테스트 전략

- 어댑터별 단위 테스트: HTTP/SDK 클라이언트를 모킹해 고정 응답으로 rawText/meta 검증.
- contentHash 안정성(같은 입력 → 같은 해시) 검증.
- 큰 원문 S3 spill 경계(4만 자) 검증.
