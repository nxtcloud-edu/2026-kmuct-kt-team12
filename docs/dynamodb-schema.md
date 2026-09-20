# DynamoDB 테이블 생성 사양 (지금 만드는 테이블용)

_단일 테이블. 리전 us-east-1. 온디맨드. 콘솔로 생성._

## 콘솔 생성값

- **Table name**: 예 `kiroton` (환경변수 `TABLE_NAME` 으로 코드에 전달)
- **Partition key**: `pk` (String)
- **Sort key**: `sk` (String)
- **Capacity**: On-demand (프로비저닝 아님)

## GSI (⚠ 반드시 추가)

`getRun(runId)` 와 `getTailoredById(outputId)` 는 portfolioId 없이 조회하므로 GSI 가 필요하다.

- **Index name**: `gsi1`
- **Partition key**: `gsi1pk` (String)
- (정렬키 없음)
- Projection: **All**

> GSI 가 없으면 runId 로 Run 을 못 찾아 폴링이 동작하지 않는다. 테이블 생성 시 같이 만들어야 한다(나중에 추가도 가능하지만 지금이 편함).

## 키 구조 (코드가 쓰는 값 — 참고)

| 항목 | pk | sk | gsi1pk |
|---|---|---|---|
| Source | `PF#{portfolioId}` | `SRC#{sourceId}` | — |
| Artifact | `PF#{portfolioId}` | `ART#{artifactId}` | — |
| Evidence | `PF#{portfolioId}` | `EVD#{evidenceId}` | — |
| MasterOutput | `PF#{portfolioId}` | `OUT#MASTER` | — |
| TailoredOutput | `PF#{portfolioId}` | `OUT#TAILORED#{outputId}` | `OUT#{outputId}` |
| Run | `PF#{portfolioId}` | `RUN#{runId}` | `RUN#{runId}` |

- 포트폴리오 통째로 읽기: `Query pk = PF#{portfolioId}` (SK prefix 로 종류 구분).
- runId 로 Run 조회: `Query gsi1 where gsi1pk = RUN#{runId}`.
- outputId 로 맞춤본 조회: `Query gsi1 where gsi1pk = OUT#{outputId}`.

## 항목 저장 형태 (어댑터가 이렇게 넣음)

각 항목은 위 pk/sk(+gsi1pk) 에 더해, 원본 객체를 `data` 필드에 통째로 JSON 으로 저장한다.
(ORM 안 씀 — steering 금지. lib-dynamodb 의 DocumentClient 로 평범한 put/query.)

```
{ pk, sk, gsi1pk?, type: 'source'|'artifact'|..., data: { ...원본 객체 } }
```

## 코드로 전달되는 환경변수

- `TABLE_NAME` — 이 테이블 이름
- (S3) `BUCKET_NAME` — 이미 만든 버킷 이름

## 팀원 체크

- [ ] pk(String)/sk(String) 파티션·정렬키
- [ ] gsi1 (gsi1pk, String) 추가, Projection All
- [ ] On-demand
- [ ] 테이블 이름을 `TABLE_NAME` 으로 세 Lambda 모두에 환경변수 설정
