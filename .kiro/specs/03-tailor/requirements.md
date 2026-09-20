# 03-tailor — requirements

## 범위

- **입력**: MasterOutput(02가 만든다)과 희망 직무명, 선택적 JD, 선택된 activityIds.
- **출력**: TailoredOutput(자기소개 intro, 역량, 관련도순 재서술 entries, 공백 리포트).
- **대상**: `docs/design.md` 3장 추가 2(직무 맞춤), 4장 5단계(직무 맞춤), 7장 outputs 엔드포인트.
- **비범위**: 수집(01), 마스터 작성(02), 화면(04). 5단계는 원문(Artifact)을 다시 읽지 않고 Evidence만 입력으로 받는다.

## 용어

- MasterOutput / TailoredOutput / Competency / ActivityEntry / Sentence: `shared/types.ts` 정의를 그대로 쓴다.
- validateTailored: `shared/validators.ts` 정의를 그대로 쓴다.

## 요구사항 (EARS)

### R1. 직무 해석

- WHEN 사용자가 직무명(선택적으로 JD)을 주면, THE 시스템 SHALL 요구 역량 5~8개를 뽑아 Competency 목록을 만든다.
- THE 시스템 SHALL 모든 AI 호출을 tool use(JSON 스키마 강제)로 수행한다.

### R2. 선별과 정렬

- THE 시스템 SHALL 선택된 활동을 역량 관련도순으로 재배열한다.
- THE 시스템 SHALL AI 추천 체크(관련도순)를 위해 활동별 관련도 신호를 제공한다.

### R3. 재서술 (근거 밖으로 나가지 않음)

- THE 시스템 SHALL 같은 활동을 직무에 맞게 재서술하되, 새 사실을 추가하지 않는다.
- THE 시스템 SHALL TailoredOutput의 intro와 entries의 모든 evidenceIds가 선택된 활동의 근거 집합 안에 있도록 만든다.
- THE 시스템 SHALL 결과에 대해 `validateTailored(output, allowedEvidenceIds)`를 실행한다.
- IF `validateTailored`가 위반을 반환하면, THEN THE 시스템 SHALL 위반 내용을 프롬프트에 붙여 1회 재시도하고, 그래도 위반인 문장은 삭제한다.

### R4. 자기소개 요약

- THE 시스템 SHALL 선택된 활동의 근거만으로 상단 3~4문장 intro를 작성한다.

### R5. 공백 리포트

- WHEN JD가 요구하는 역량에 대응하는 근거가 없으면, THE 시스템 SHALL 그 Competency의 evidenceIds를 비운 채로 두어 "근거 없음"으로 표시한다.

### R6. 원본 변경 표시

- THE 시스템 SHALL TailoredOutput.basedOnMasterAt에 사용한 마스터 시각을 기록한다.
- WHEN 마스터가 basedOnMasterAt보다 새로우면, THE 시스템 SHALL "원본이 바뀜" 표시를 낼 수 있게 한다(표시는 04가 렌더).

### R7. 저장/설정

- THE 시스템 SHALL TailoredOutput을 `PF#{portfolioId}` / `OUT#TAILORED#{outputId}` 키로 저장한다.
- THE 시스템 SHALL Bedrock 모델 ID를 환경 변수 `BEDROCK_MODEL_ID`로 받는다.
