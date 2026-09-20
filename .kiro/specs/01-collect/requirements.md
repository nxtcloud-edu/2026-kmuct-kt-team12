# 01-collect — requirements

## 범위

- **입력**: 공개 URL(깃허브, 노션, 블로그/웹)과 로컬 파일(PDF, 문서, 이미지).
- **출력**: DynamoDB에 저장된 Source와 Artifact(원문 텍스트 + contentHash).
- **대상**: `docs/design.md` 4장 1단계(수집, AI 없음), 6장 출처별 수집 방법, 7장의 sources 관련 엔드포인트.
- **비범위**: 추출/통합/마스터(02), 직무 맞춤(03), 화면(04). 수집 단계에는 AI를 쓰지 않는다.

## 용어

- Source / Artifact / SourceKind: `shared/types.ts` 정의를 그대로 쓴다.

## 요구사항 (EARS)

### R1. 출처 등록

- WHEN 사용자가 URL을 등록하면, THE 시스템 SHALL kind(`github`/`notion`/`web`)를 판별해 Source를 만든다.
- WHEN 사용자가 파일을 등록하면, THE 시스템 SHALL kind `file`인 Source를 만들고 S3 presigned upload URL을 발급한다.
- THE 시스템 SHALL Source를 `PF#{portfolioId}` / `SRC#{sourceId}` 키로 DynamoDB에 저장한다.

### R2. 수집 (1단계, AI 없음)

- WHEN 깃허브 URL이면, THE 시스템 SHALL REST API로 README, 저장소 정보, 언어, 첫/마지막 커밋 날짜를 읽어 rawText와 meta를 만든다.
- WHEN 블로그/웹 URL이면, THE 시스템 SHALL 페이지를 요청한 뒤 본문 추출(Readability)로 rawText를 만든다.
- WHEN 노션 URL이면, THE 시스템 SHALL 공식 API + 통합 토큰으로 본문을 읽는다.
- WHEN 파일이면, THE 시스템 SHALL S3에 업로드된 원본을 Bedrock document/image 블록 입력으로 넘길 수 있도록 s3Key를 보관한다.
- THE 시스템 SHALL rawText가 4만 자를 초과하면 S3에 두고 `rawTextS3Key`를 채운다.
- THE 시스템 SHALL 모든 Artifact에 대해 `contentHash = sha256(rawText)`를 계산한다.
- THE 시스템 SHALL Artifact를 `PF#{portfolioId}` / `ART#{artifactId}` 키로 저장한다.

### R3. 갱신 감지 지원

- WHEN 같은 Source를 다시 수집하면, THE 시스템 SHALL 새 contentHash를 계산해 기존 값과 비교할 수 있게 저장한다(재처리 판단은 02가 한다).

### R4. 토큰/설정

- THE 시스템 SHALL 깃허브 토큰과 노션 통합 토큰을 환경 변수로 받는다.
- IF 비인증 호출 한도에 걸리면, THEN THE 시스템 SHALL 오류를 Run.events에 남기고 해당 출처만 실패로 표시한다(전체를 멈추지 않는다).

### R5. 삭제

- WHEN 사용자가 출처를 삭제하면, THE 시스템 SHALL 해당 Source와 그 Artifact를 제거한다.
