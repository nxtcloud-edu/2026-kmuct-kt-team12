# 요구사항 — 포트폴리오 생성기 (재설계)

_이 spec은 리드 엔지니어 명세(2026-09-20 재지시)를 근거로 한다. 기존 spec 01~04(직무맞춤·근거추적 설계)를 대체한다._

## 개요

깃허브·노션·티스토리에 흩어진 활동 기록을 수집→시간순 정리→AI 키워드/경험 구조화→단답형 질문 확인→확인된 경험만으로 정적 포트폴리오 HTML을 생성해 S3에 저장한다.

핵심 규칙:
- AI가 유추한 경험은 포트폴리오에 직접 쓰지 않는다. 질문으로만 쓰고 사용자가 "예" 한 것만 반영.
- 모든 경험은 출처(`origin` = `record` | `answer`)를 가지며 사이트에서 구분 표시.
- 만들지 않는 것: 로그인, OAuth, 자동 갱신, 디자인 템플릿 선택, 직무별 맞춤 버전.

## 사용자 흐름 (6단계)

1. 연결: 깃허브 토큰 / 노션 토큰 / 티스토리 주소 입력 → 수집
2. 분류: 기록을 제목/시간/본문으로 나누고 시간순 정렬
3. 표시: 타임라인 화면, 제외할 기록 체크 해제
4. 매핑: AI가 상위 키워드 + 하위 경험 추출 (quote 필수, 코드 검증)
5. 매칭: AI가 키워드에서 유추한 경험을 예/아니오 질문으로. "예"만 경험 자산 추가
6. 생성: 경험 자산으로 포트폴리오 문장 + 정적 HTML → S3

## EARS 요구사항

### R1 세션·연결
- WHEN 사용자가 세션을 시작하면 THE 시스템 SHALL `crypto.randomUUID()` sessionId를 발급한다.
- WHEN 연결 검증 요청을 받으면 THE 시스템 SHALL 각 출처를 1회 가벼운 호출(github GET /user, notion GET /v1/users/me, tistory RSS)로 10초 내 검증하고 ok/fail을 반환한다.
- THE 시스템 SHALL 토큰(Connections)을 어떤 DynamoDB 항목에도 저장하지 않는다.

### R2 작업(Job)
- WHEN 작업 생성 요청을 받고 같은 세션에 running Job이 있으면 THE 시스템 SHALL 409를 반환한다.
- THE 시스템 SHALL kind별 선행 조건을 검사한다: keywords는 제외 안 된 기록 1개+, questions는 키워드 1개+, generate는 경험 1개+. 미충족 시 409 + 안내.
- WHEN 작업 Lambda가 시작하면 THE 시스템 SHALL 조건부 쓰기(attribute_not_exists(startedAt))로 중복 실행을 방지한다.
- THE 작업 Lambda SHALL 모든 예외를 잡아 Job.status=failed + 한국어 사유 event 남기고 정상 종료(예외 재던지기 금지).
- WHEN 남은 시간이 30초 미만이면 THE 시스템 SHALL 지금까지 결과로 마무리하고 "시간 제한으로 일부만 처리했습니다"를 남긴다.

### R3 수집(collector)
- 모든 외부 요청은 safeFetch(SSRF 차단, 리다이렉트 3회 재검사, 10초 타임아웃, 2MB 제한)를 거친다.
- 자동 제외된 기록은 버리지 않고 excluded=true + excludedReason으로 저장.
- 출처 하나가 실패해도 나머지로 계속. 기록 0개일 때만 failed.
- 재수집 시 같은 url 기록은 덮어쓰되 사용자가 바꾼 excluded 값은 유지.

### R4 AI 매핑(keywords)
- 제외 안 된 기록마다 1회 호출(AI_CONCURRENCY 병렬). quote는 body에 글자 그대로 10자+ 구절.
- 코드 검증: 공백 정규화 후 quote가 body 부분문자열이 아니면 그 experience 폐기, 폐기 수 event.
- 키워드 통일 1회 호출(최대 12개). 입력에 없던 이름이 매핑 키로 나오면 무시.
- 재실행 시 origin=record 항목만 삭제 후 재생성, origin=answer + Question 유지.

### R5 AI 매칭(questions)
- 1회 호출, 최대 8개. keywordName이 실제 키워드에 없으면/inferredExperience가 기존 경험과 포함관계면 폐기. 8개 초과 폐기.
- 기존 pending 삭제 후 재생성, 답한(yes/no/skipped) 질문 유지.

### R6 생성(generate)
- status=yes 질문을 Experience(origin=answer)로 변환. detail 있으면 1회 호출로 다듬고, 없으면 inferredExperience 그대로.
- PortfolioContent 1회 호출 생성. 코드 검증: 존재하지 않는 recordId/keywordId 항목 삭제, 입력에 없는 영문 기술명 bullet 삭제.
- siteTemplate로 단일 index.html 생성(AI가 HTML 작성 안 함, escape 필수). S3 키 `sites/{sessionId}/index.html` 덮어쓰기.

### R7 API
- 명세 7장 엔드포인트 그대로. 에러는 `{ error: { code, message(한국어) } }`. `/sites/{sessionId}`만 HTML 반환.

### R8 Frontend
- HashRouter 6화면. API는 src/api.ts 한 곳. VITE_USE_MOCK=true면 mock. dangerouslySetInnerHTML 금지. 토큰은 메모리에만.

### R9 환경 제약
- 리전 us-east-1 고정. 금지 AWS 서비스/의존성 사용 안 함. 인프라 정의 파일 없음. 로컬 AWS 접속 코드 없음(테스트 전부 모킹).
