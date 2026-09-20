// backend/src/lib/db.ts
// DynamoDB 단일 테이블 접근. 리전 us-east-1 고정.
// PK=SES#{sessionId}, SK=META/REC#{id}/KW#{id}/EXP#{id}/Q#{id}/JOB#{id}/SITE
//
// 실제 구현(DynamoStore)과 테스트용 in-memory(MemoryStore)를 같은 Store 인터페이스로 제공.
// SDK는 이 파일에서만 생성한다.

import type {
  RecordItem,
  Keyword,
  Experience,
  Question,
  Job,
  SiteInfo,
} from '../types.js';

export const REGION = 'us-east-1';

export function pk(sessionId: string): string {
  return `SES#${sessionId}`;
}

// SK 빌더
export const SK = {
  meta: () => 'META',
  rec: (id: string) => `REC#${id}`,
  kw: (id: string) => `KW#${id}`,
  exp: (id: string) => `EXP#${id}`,
  q: (id: string) => `Q#${id}`,
  job: (id: string) => `JOB#${id}`,
  site: () => 'SITE',
} as const;

// 저장되는 항목 형태 (PK/SK + 페이로드)
export interface Item {
  PK: string;
  SK: string;
  [k: string]: unknown;
}

export interface Store {
  put(item: Item): Promise<void>;
  get(pkVal: string, sk: string): Promise<Item | undefined>;
  // PK 일치 + SK begins_with. 페이지네이션은 내부에서 모두 순회.
  queryByPrefix(pkVal: string, skPrefix: string): Promise<Item[]>;
  // Job.events 를 list_append 로 추가. 존재하지 않으면 실패하지 않고 무시하지 않도록 upsert 아님.
  appendJobEvents(pkVal: string, sk: string, events: Job['events']): Promise<void>;
  // 조건부 startedAt 기록. 이미 있으면 false 반환(중복 실행).
  markStarted(pkVal: string, sk: string): Promise<boolean>;
  // status 등 top-level 속성 설정
  update(pkVal: string, sk: string, attrs: Record<string, unknown>): Promise<void>;
  deleteMany(pkVal: string, sks: string[]): Promise<void>;
}

// ─────────────────────────────────────────────
// 도메인 편의 함수 (Store 위에 얹음)
// ─────────────────────────────────────────────

export function itemToRecord(it: Item): RecordItem {
  const { PK: _p, SK: _s, ...rest } = it;
  return rest as unknown as RecordItem;
}
export function itemToKeyword(it: Item): Keyword {
  const { PK: _p, SK: _s, ...rest } = it;
  return rest as unknown as Keyword;
}
export function itemToExperience(it: Item): Experience {
  const { PK: _p, SK: _s, ...rest } = it;
  return rest as unknown as Experience;
}
export function itemToQuestion(it: Item): Question {
  const { PK: _p, SK: _s, ...rest } = it;
  return rest as unknown as Question;
}
export function itemToJob(it: Item): Job {
  const { PK: _p, SK: _s, startedAt: _st, ...rest } = it as Item & { startedAt?: string };
  return rest as unknown as Job;
}
export function itemToSite(it: Item): SiteInfo {
  const { PK: _p, SK: _s, ...rest } = it;
  return rest as unknown as SiteInfo;
}

export async function getRecords(store: Store, sessionId: string): Promise<RecordItem[]> {
  const items = await store.queryByPrefix(pk(sessionId), 'REC#');
  return items.map(itemToRecord);
}
export async function getKeywords(store: Store, sessionId: string): Promise<Keyword[]> {
  const items = await store.queryByPrefix(pk(sessionId), 'KW#');
  return items.map(itemToKeyword);
}
export async function getExperiences(store: Store, sessionId: string): Promise<Experience[]> {
  const items = await store.queryByPrefix(pk(sessionId), 'EXP#');
  return items.map(itemToExperience);
}
export async function getQuestions(store: Store, sessionId: string): Promise<Question[]> {
  const items = await store.queryByPrefix(pk(sessionId), 'Q#');
  return items.map(itemToQuestion);
}

export function putRecord(store: Store, r: RecordItem): Promise<void> {
  return store.put({ PK: pk(r.sessionId), SK: SK.rec(r.id), ...r });
}
export function putKeyword(store: Store, sessionId: string, k: Keyword): Promise<void> {
  return store.put({ PK: pk(sessionId), SK: SK.kw(k.id), ...k });
}
export function putExperience(store: Store, sessionId: string, e: Experience): Promise<void> {
  return store.put({ PK: pk(sessionId), SK: SK.exp(e.id), ...e });
}
export function putQuestion(store: Store, sessionId: string, q: Question): Promise<void> {
  return store.put({ PK: pk(sessionId), SK: SK.q(q.id), ...q });
}
export function putSite(store: Store, s: SiteInfo): Promise<void> {
  return store.put({ PK: pk(s.sessionId), SK: SK.site(), ...s });
}

// ─────────────────────────────────────────────
// In-memory 구현 (테스트/로컬)
// ─────────────────────────────────────────────

export class MemoryStore implements Store {
  private map = new Map<string, Item>();
  private key(pkVal: string, sk: string) {
    return `${pkVal}\u0000${sk}`;
  }
  async put(item: Item): Promise<void> {
    this.map.set(this.key(item.PK, item.SK), structuredClone(item));
  }
  async get(pkVal: string, sk: string): Promise<Item | undefined> {
    const it = this.map.get(this.key(pkVal, sk));
    return it ? structuredClone(it) : undefined;
  }
  async queryByPrefix(pkVal: string, skPrefix: string): Promise<Item[]> {
    const out: Item[] = [];
    for (const it of this.map.values()) {
      if (it.PK === pkVal && it.SK.startsWith(skPrefix)) out.push(structuredClone(it));
    }
    return out;
  }
  async appendJobEvents(pkVal: string, sk: string, events: Job['events']): Promise<void> {
    const it = this.map.get(this.key(pkVal, sk));
    if (!it) throw new Error('append 대상 Job 없음');
    const cur = (it.events as Job['events']) ?? [];
    it.events = [...cur, ...events];
  }
  async markStarted(pkVal: string, sk: string): Promise<boolean> {
    const it = this.map.get(this.key(pkVal, sk));
    if (!it) throw new Error('markStarted 대상 없음');
    if ((it as Item & { startedAt?: string }).startedAt) return false;
    (it as Item & { startedAt?: string }).startedAt = new Date().toISOString();
    return true;
  }
  async update(pkVal: string, sk: string, attrs: Record<string, unknown>): Promise<void> {
    const it = this.map.get(this.key(pkVal, sk));
    if (!it) throw new Error('update 대상 없음');
    Object.assign(it, attrs);
  }
  async deleteMany(pkVal: string, sks: string[]): Promise<void> {
    for (const sk of sks) this.map.delete(this.key(pkVal, sk));
  }
  // 테스트 헬퍼
  _dump(): Item[] {
    return [...this.map.values()].map((i) => structuredClone(i));
  }
}

// ─────────────────────────────────────────────
// DynamoDB 구현 (런타임 전용, 테스트에서 로드 안 함)
// ─────────────────────────────────────────────

export function createDynamoStore(tableName: string): Store {
  // 지연 로딩: 테스트 환경에서 SDK를 요구하지 않도록 동적 import 대신
  // 런타임에서만 생성됨. 번들에는 esbuild가 포함.
  return new DynamoStoreLazy(tableName);
}

class DynamoStoreLazy implements Store {
  private docPromise: Promise<import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient> | null = null;
  private cmds: typeof import('@aws-sdk/lib-dynamodb') | null = null;
  constructor(private tableName: string) {}

  private async doc() {
    if (!this.docPromise) {
      this.docPromise = (async () => {
        const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
        this.cmds = await import('@aws-sdk/lib-dynamodb');
        const base = new DynamoDBClient({ region: REGION });
        return this.cmds.DynamoDBDocumentClient.from(base, {
          marshallOptions: { removeUndefinedValues: true },
        });
      })();
    }
    return this.docPromise;
  }

  async put(item: Item): Promise<void> {
    const doc = await this.doc();
    await doc.send(new this.cmds!.PutCommand({ TableName: this.tableName, Item: item }));
  }
  async get(pkVal: string, sk: string): Promise<Item | undefined> {
    const doc = await this.doc();
    const r = await doc.send(
      new this.cmds!.GetCommand({ TableName: this.tableName, Key: { PK: pkVal, SK: sk } }),
    );
    return r.Item as Item | undefined;
  }
  async queryByPrefix(pkVal: string, skPrefix: string): Promise<Item[]> {
    const doc = await this.doc();
    const out: Item[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const r = await doc.send(
        new this.cmds!.QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': pkVal, ':sk': skPrefix },
          ExclusiveStartKey,
        }),
      );
      for (const it of r.Items ?? []) out.push(it as Item);
      ExclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ExclusiveStartKey);
    return out;
  }
  async appendJobEvents(pkVal: string, sk: string, events: Job['events']): Promise<void> {
    const doc = await this.doc();
    await doc.send(
      new this.cmds!.UpdateCommand({
        TableName: this.tableName,
        Key: { PK: pkVal, SK: sk },
        UpdateExpression:
          'SET #ev = list_append(if_not_exists(#ev, :empty), :new)',
        ExpressionAttributeNames: { '#ev': 'events' },
        ExpressionAttributeValues: { ':new': events, ':empty': [] },
      }),
    );
  }
  async markStarted(pkVal: string, sk: string): Promise<boolean> {
    const doc = await this.doc();
    try {
      await doc.send(
        new this.cmds!.UpdateCommand({
          TableName: this.tableName,
          Key: { PK: pkVal, SK: sk },
          UpdateExpression: 'SET startedAt = :now',
          ConditionExpression: 'attribute_not_exists(startedAt)',
          ExpressionAttributeValues: { ':now': new Date().toISOString() },
        }),
      );
      return true;
    } catch (e) {
      if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return false;
      throw e;
    }
  }
  async update(pkVal: string, sk: string, attrs: Record<string, unknown>): Promise<void> {
    const doc = await this.doc();
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const sets: string[] = [];
    let i = 0;
    for (const [k, v] of Object.entries(attrs)) {
      const nk = `#a${i}`;
      const vk = `:v${i}`;
      names[nk] = k;
      values[vk] = v;
      sets.push(`${nk} = ${vk}`);
      i++;
    }
    await doc.send(
      new this.cmds!.UpdateCommand({
        TableName: this.tableName,
        Key: { PK: pkVal, SK: sk },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }
  async deleteMany(pkVal: string, sks: string[]): Promise<void> {
    const doc = await this.doc();
    for (const sk of sks) {
      await doc.send(
        new this.cmds!.DeleteCommand({ TableName: this.tableName, Key: { PK: pkVal, SK: sk } }),
      );
    }
  }
}
