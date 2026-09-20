# DECISIONS

한 줄씩 append 합니다. 재구성하지 않습니다.

## 형상관리 (2026-09-20)

- 브랜치 전략: `main`(배포) ← `develop`(통합) ← `feature/<기능이름>`(작업). 기본 브랜치는 `develop`.
- 브랜치 보호는 repository **ruleset** 하나로만 관리한다. classic branch protection 은 쓰지 않는다 — 두 메커니즘을 겹치면 push 거부 시 어느 쪽이 막았는지 추적이 안 된다. 초기 세팅 중 `main`/`develop` 에 걸었던 classic protection 은 제거했다.
- ruleset `protection rule`(id 23715238) 적용 범위는 `refs/heads/main`, `refs/heads/develop` 로 한정한다. 최초 설정값은 `~ALL` 이었고, 그 상태에서는 `feature/*` 에도 PR 필수·삭제 금지가 걸려 작업 브랜치에 커밋을 올릴 수 없었다.
- ruleset 규칙: `pull_request`(승인 1), `non_fast_forward`(force push 금지), `deletion`(브랜치 삭제 금지).
- 협업자 5명 전원이 admin 이므로 admin 우회를 허용하지 않는다. 우회 대상은 기존 GitHub App 3개(`bypass_actors`)로 한정한다. 우회를 허용하면 보호 규칙이 아무에게도 적용되지 않는다.
- `.gitignore` 는 `scm.sh init` 기본선을 그대로 쓴다. 의존성 디렉토리와 환경변수·인증서 파일류를 먼저 막는 목적.
- 포기한 대안: classic branch protection 단독 사용. ruleset 이 GitHub 의 현행 메커니즘이고 이미 저장소에 존재했으므로 그쪽으로 통일했다.
- 알려진 한계: PR 승인 1명이 필요하므로 혼자서는 `develop` 에 머지할 수 없다. 승인자를 구할 수 없는 상황이 반복되면 승인 수를 0 으로 내리는 것을 검토한다(그 경우 직접 push 는 여전히 막힌다).
- 위 한계가 바로 발생해 `required_approving_review_count` 를 1 → 0 으로 내렸다. GitHub 은 자기 PR 을 승인할 수 없어 단독 작업이 막힌다. PR 경유 필수와 force push·삭제 금지는 그대로 유지되므로 직접 push 차단은 유효하다. 리뷰 품질은 규칙이 아니라 팀 합의로 지킨다 — 머지 전 팀원 1명 리뷰를 관례로 삼는다.
- `require_extra_approval_for_unattributed_changes` 는 true 로 남긴다. 커밋 이메일이 GitHub 계정에 연결되지 않은 변경은 승인 수 0 과 무관하게 추가 승인을 요구한다.

## LLM 호출 경로 (2026-09-20)

- LLM 호출은 Bedrock SDK 가 아니라 대회 제공 **OpenAI 호환 게이트웨이**(LiteLLM)를 쓴다. 계정에 `bedrock:InvokeModel` 권한이 없고 접근이 게이트웨이로만 열려 있다. `@aws-sdk/client-bedrock-runtime` 의존성을 제거했다.
- 환경 변수는 `LLM_BASE_URL`, `LLM_API_KEY`, 그리고 기존 `BEDROCK_MODEL_ID`(게이트웨이 모델 별칭을 담는다). ai-worker Lambda 에만 넣는다 — LLM 을 부르는 유일한 함수다.
- `BEDROCK_MODEL_ID` 이름을 유지한 이유: 호출부 4곳(`aiworker/{index,keywords,questions,generate}.ts`)이 `modelId` 로 전달하는 배선을 그대로 쓰면 변경 범위가 파일 1개로 끝난다. 값만 별칭(`bedrock-haiku`)으로 바뀐다.
- `LLM_BASE_URL`/`LLM_API_KEY` 는 `converse()` 안에서 `process.env` 로 읽는다. 4개 파일에 파라미터 두 개를 더 흘리는 대신 "LLM 호출은 이 파일에서만" 규칙을 유지했다.
- 스키마 강제는 `tools` + `tool_choice`(함수 지정)로 한다. 게이트웨이에서 동작을 실측 확인했다(tool_calls 수신, 인용문 3/3 원문 일치).
- 응답 `arguments` 가 객체가 아니라 JSON 문자열이라 `JSON.parse` 가 필요하다. 잘린 JSON 이 올 수 있어 파싱 실패를 재시도 대상에 넣었다(`ToolResultError`).
- 재시도 판정을 예외 이름(`ThrottlingException` 등)에서 **HTTP 상태**(408/425/429/5xx)와 네트워크 오류(`TypeError`)로 바꿨다. 백오프 1초·3초 2회는 유지.
- 게이트웨이는 설정으로 고정된 신뢰 대상이므로 `safeFetch`(사용자 입력 URL 방어)를 통과시키지 않고 `fetch` 를 직접 쓴다.
- 포기한 대안: `openai` npm 패키지. POST 한 번이라 내장 `fetch` 로 충분하고 Lambda 번들이 작아진다.
- 알려진 한계: 예산이 `max_budget` $10 고정이고 리셋이 없다(`soft_budget` $8). 기본 모델을 `bedrock-haiku` 로 둔다. rpm 60, 동시 8.
- 알려진 한계: OpenAI 호환 Chat Completions 에는 document 블록이 없어 PDF 원문을 모델에 그대로 넘길 수 없다. 파일 출처는 별도 텍스트 추출 경로가 필요하다.
