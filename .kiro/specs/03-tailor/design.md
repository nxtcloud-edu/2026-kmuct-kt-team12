# 03-tailor — design

## 개요

MasterOutput과 직무 입력을 받아 TailoredOutput을 만든다. 원문을 다시 읽지 않고 Evidence만 입력으로 받으므로 가볍고, 직무를 바꿔 여러 번 만들어도 된다. 근거 밖으로 나가지 않는 것을 `validateTailored`가 강제한다.

## 순수 함수

```
interpretRole(role, jdText?, deps): Promise<Competency[]>      // 역량 5~8개
rankActivities(master, competencies, deps): { activityId, score }[]
retell(master, selectedIds, competencies, deps): Promise<{ intro, entries }>
composeTailored(portfolioId, master, role, jdText?, selectedIds, deps): Promise<TailoredOutput>
```

- `allowedEvidenceIds` = 선택된 activityId들에 속한 Evidence id 집합. retell 결과는 이 집합 안에서만 evidenceIds를 쓸 수 있다.

## 흐름

```
competencies = await interpretRole(role, jdText)
ranked       = rankActivities(master, competencies)      // AI 추천 체크용 신호
{intro, entries} = await retell(master, selectedIds, competencies)
output = { kind:'tailored', ..., competencies, intro, entries, basedOnMasterAt: master.generatedAt }
violations = validateTailored(output, allowedEvidenceIds)
if (violations.length) retry once with violations in prompt; then drop still-violating sentences
save(output)
```

## 공백 리포트

- interpretRole가 만든 Competency 중 대응 근거가 없는 것은 evidenceIds가 빈 채로 남는다 → 화면이 "근거 없음"으로 렌더.

## Bedrock

- Converse API + tool use. 모델 ID `BEDROCK_MODEL_ID`.
- retell tool 스키마: `{ intro: Sentence[], entries: ActivityEntry[] }` (evidenceIds 필수).

## 테스트 전략

- 샘플 MasterOutput + "백엔드 개발자" → TailoredOutput (문서 5인 분업안 D 첫 산출물).
- 단위 테스트(Bedrock 모킹): 근거 밖 evidenceId를 넣은 응답이 validateTailored로 걸러지는지.
- 공백 리포트: JD 요구 역량에 근거 없으면 빈 evidenceIds로 남는지.
