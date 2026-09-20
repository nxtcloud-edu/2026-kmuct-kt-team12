# 02-pipeline-master — design

## 개요

Worker Lambda 안에서 2~4단계(추출 → 통합 → 마스터 작성)와 갱신을 수행한다. 순수 함수 3개로 구현해 테스트 가능하게 한다. 환각 방지는 `shared/validators.ts`가 강제한다.

## 순수 함수 3개

```
extractEvidence(artifact: Artifact, deps): Promise<Evidence[]>
consolidateActivities(evidence: Evidence[], deps): Evidence[]  // activityId 채움 + 기간 추론
composeMaster(portfolioId, activities, deps): Promise<MasterOutput>
```

- `deps`는 Bedrock 호출 함수와 로거를 주입한다(테스트에서 모킹).
- 부수효과(DynamoDB 읽기/쓰기, Run.events append)는 함수 밖 오케스트레이션 계층에 둔다.

## 흐름

```
build:
  artifacts = loadArtifacts(portfolioId)
  evidence  = flatten(await mapWithConcurrency(artifacts, extractEvidence, EXTRACT_CONCURRENCY))
  evidence  = evidence.filter(e => verifyQuote(artifactOf(e), e.quoteRef.quote) !== null)
  activities = consolidateActivities(evidence)
  master     = await composeMaster(portfolioId, activities)
  master.entries.forEach(e => enforceValidateEntry(e, evidenceIdSet))   // 1회 재시도 후 문장 삭제
  save(master); appendEvent(...)

refresh:
  changed = artifacts.filter(a => a.contentHash !== stored.contentHash)
  reExtract only for changed; reuse existing evidence for unchanged
  consolidate + compose over ALL; keep lockedFields values
```

## 병렬 처리

- `mapWithConcurrency(items, fn, limit)`: limit개씩 동시 실행하는 유틸. Bedrock 분당 호출 한도가 낮으면 limit=2로 내린다.
- 동시 실행 수는 `EXTRACT_CONCURRENCY`(기본 3).

## 검증 지점 (코드가 강제)

| 단계 | 검증 | 실패 시 |
|---|---|---|
| 2 추출 | `verifyQuote(artifact, quote)` | 후보 폐기, 폐기 수를 Run.events에 기록 |
| 4 마스터 | `validateEntry(entry, evidenceIds)` | 위반을 프롬프트에 붙여 1회 재시도, 그래도 실패한 문장 삭제 |

## Bedrock 호출

- Converse API + tool use. 모델 ID는 `BEDROCK_MODEL_ID`.
- 추출 tool 스키마: `{ evidences: [{ field, claim, quote }] }`. start/end는 받지 않는다(코드가 계산).
- 실패 시 지수 백오프 재시도 2회.

## Run.events 메시지 (한국어)

- 추출: "근거 N개를 찾았습니다 (폐기 M개)"
- 통합: "N개 링크가 하나의 활동으로 합쳐졌습니다"
- 마스터: "마스터 타임라인 N개 활동을 정리했습니다"

## 테스트 전략

- `fixtures/`에 Artifact 샘플 JSON 4개: 깃허브 README, 회고 블로그, 반말 노션 메모, 공모전 기획서 텍스트.
- **단위 테스트**: Bedrock을 모킹. extractEvidence/consolidateActivities/composeMaster를 각각, 그리고 verifyQuote 폐기 경로를 검증.
- **통합 테스트 스크립트**: 실제 Bedrock을 호출(별도 파일로 분리, CI에서 제외).
