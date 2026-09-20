# 02-pipeline-master — requirements

## 범위

- **입력**: DynamoDB에 저장된 Artifact들 (01-collect가 만든다. 이 spec에서는 수집을 구현하지 않는다).
- **출력**: Evidence들과 MasterOutput.
- **대상**: `docs/design.md` 4장의 2단계(추출), 3단계(통합), 4단계(마스터 작성)와 갱신 로직.
- **비범위**: 수집(01), 직무 맞춤(03), 화면(04).

## 용어

- Artifact / Evidence / MasterOutput / ActivityEntry / Run: `shared/types.ts` 정의를 그대로 쓴다.
- verifyQuote / validateEntry: `shared/validators.ts` 정의를 그대로 쓴다.

## 요구사항 (EARS)

### R1. 추출 (2단계)

- WHEN Worker가 build 모드로 실행되면, THE 시스템 SHALL 포트폴리오의 각 Artifact에 대해 `extractEvidence`를 호출해 Evidence 후보를 만든다.
- THE 시스템 SHALL Artifact별 추출을 `Promise.all`로 병렬 실행하며, 동시 실행 수를 환경 변수 `EXTRACT_CONCURRENCY`(기본 3)로 제한한다.
- WHEN 추출된 Evidence 후보의 인용문이 `verifyQuote`를 통과하면, THE 시스템 SHALL 그 Evidence를 저장한다.
- IF 인용문이 `verifyQuote`를 통과하지 못하면, THEN THE 시스템 SHALL 그 후보를 버린다.
- WHEN 추출 단계가 끝나면, THE 시스템 SHALL 폐기한 후보 개수를 Run.events에 한국어 메시지로 남긴다.
- THE 시스템 SHALL 모든 Bedrock 호출을 tool use(JSON 스키마 강제)로 수행하며, 자유 텍스트를 파싱하지 않는다.
- THE 시스템 SHALL QuoteRef의 start/end를 AI가 아니라 코드(`verifyQuote`)로 계산한다.

### R2. 통합 (3단계)

- WHEN 추출이 끝나면, THE 시스템 SHALL 전체 Evidence를 입력으로 `consolidateActivities`를 호출해 같은 활동을 가리키는 근거를 묶는다.
- THE 시스템 SHALL 각 Evidence가 정확히 하나의 Activity에 속하도록 activityId를 채운다.
- THE 시스템 SHALL 기간을 추론하되, 추론된 기간은 `Period.inferred = true`로 표시한다.
- WHEN 여러 출처가 하나의 활동으로 합쳐지면, THE 시스템 SHALL Run.events에 "N개 링크가 하나의 활동으로 합쳐졌습니다" 형식의 메시지를 남긴다.

### R3. 마스터 작성 (4단계)

- WHEN 통합이 끝나면, THE 시스템 SHALL `composeMaster`를 호출해 Activity들을 표준 폼(ActivityEntry)으로 채운 MasterOutput을 만든다.
- THE 시스템 SHALL MasterOutput.entries를 `period.start` 기준으로 정렬한다.
- THE 시스템 SHALL 값이 없는 칸을 null로 둔다(억지로 채우지 않는다).
- THE 시스템 SHALL 각 ActivityEntry가 `validateEntry`를 통과하도록 만든다.
- IF `validateEntry`가 위반을 반환하면, THEN THE 시스템 SHALL 위반 내용을 프롬프트에 붙여 1회만 재시도한다.
- IF 재시도 후에도 특정 문장이 위반이면, THEN THE 시스템 SHALL 그 문장을 삭제한다.

### R4. 갱신 (refresh)

- WHEN Worker가 refresh 모드로 실행되면, THE 시스템 SHALL contentHash가 바뀐 Artifact에 대해서만 2단계를 다시 돌린다.
- THE 시스템 SHALL 3단계와 4단계는 전체를 다시 돌린다.
- WHILE 4단계를 다시 돌리는 동안, THE 시스템 SHALL `lockedFields`에 있는 칸은 기존 값을 유지한다(덮어쓰지 않는다).

### R5. 실행 상태

- THE 시스템 SHALL 단계가 끝날 때마다 Run.events에 사용자에게 보여줄 한국어 메시지를 추가한다.
- WHEN 파이프라인이 끝나면, THE 시스템 SHALL Run.status를 done으로, 실패 시 failed로 설정한다.

### R6. 설정

- THE 시스템 SHALL Bedrock 모델 ID를 환경 변수 `BEDROCK_MODEL_ID`로 받는다.
- THE 시스템 SHALL 추출 동시 실행 수를 환경 변수 `EXTRACT_CONCURRENCY`(기본 3)로 받는다.
