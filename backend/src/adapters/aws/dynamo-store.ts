// backend/src/adapters/aws/dynamo-store.ts
// DynamoDB 단일 테이블 어댑터. 팀 테이블: PK/SK 대문자, gsi1(gsi1pk).

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    PutCommand,
    GetCommand,
    QueryCommand,
    DeleteCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { StorePort } from '../../ports.js';
import type {
    Source,
    Artifact,
    Evidence,
    MasterOutput,
    TailoredOutput,
    Run,
    MatchSession,
} from '../../../../shared/types.js';

const PK = 'PK';
const SK = 'SK';
const GSI1PK = 'gsi1pk';
const GSI1SK = 'gsi1sk';
const GSI_NAME = 'gsi1';

export class DynamoStore implements StorePort {
    private doc: DynamoDBDocumentClient;
    private table: string;
    /** putArtifact 에서 portfolioId 를 알기 위한 캐시 */
    private sourcePortfolio = new Map<string, string>();

    constructor(tableName: string, client?: DynamoDBClient) {
        this.table = tableName;
        this.doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}), {
            marshallOptions: { removeUndefinedValues: true },
        });
    }

    // ---------- Portfolio ----------
    async createPortfolio(portfolioId: string): Promise<void> {
        await this.doc.send(new PutCommand({
            TableName: this.table,
            Item: { [PK]: `PF#${portfolioId}`, [SK]: 'META', type: 'portfolio', data: { portfolioId } },
        }));
    }

    // ---------- Source ----------
    async putSource(s: Source): Promise<void> {
        this.sourcePortfolio.set(s.id, s.portfolioId);
        await this.doc.send(new PutCommand({
            TableName: this.table,
            Item: { [PK]: `PF#${s.portfolioId}`, [SK]: `SRC#${s.id}`, type: 'source', data: s },
        }));
    }

    async getSources(portfolioId: string): Promise<Source[]> {
        const res = await this.doc.send(new QueryCommand({
            TableName: this.table,
            KeyConditionExpression: `${PK} = :pk AND begins_with(${SK}, :prefix)`,
            ExpressionAttributeValues: { ':pk': `PF#${portfolioId}`, ':prefix': 'SRC#' },
        }));
        const sources = (res.Items ?? []).map((i) => i.data as Source);
        for (const s of sources) this.sourcePortfolio.set(s.id, s.portfolioId);
        return sources;
    }

    async deleteSource(portfolioId: string, sourceId: string): Promise<void> {
        await this.doc.send(new DeleteCommand({
            TableName: this.table,
            Key: { [PK]: `PF#${portfolioId}`, [SK]: `SRC#${sourceId}` },
        }));
        // 연관 아티팩트도 삭제
        const artifacts = await this.getArtifacts(portfolioId);
        for (const a of artifacts) {
            if (a.sourceId === sourceId) {
                await this.doc.send(new DeleteCommand({
                    TableName: this.table,
                    Key: { [PK]: `PF#${portfolioId}`, [SK]: `ART#${a.id}` },
                }));
            }
        }
    }

    // ---------- Artifact ----------
    async putArtifact(a: Artifact): Promise<void> {
        const portfolioId = this.sourcePortfolio.get(a.sourceId);
        if (!portfolioId) throw new Error(`artifact ${a.id} 의 소속 portfolioId 를 찾을 수 없음 (sourceId=${a.sourceId})`);
        await this.doc.send(new PutCommand({
            TableName: this.table,
            Item: { [PK]: `PF#${portfolioId}`, [SK]: `ART#${a.id}`, type: 'artifact', data: a },
        }));
    }

    async getArtifacts(portfolioId: string): Promise<Artifact[]> {
        const res = await this.doc.send(new QueryCommand({
            TableName: this.table,
            KeyConditionExpression: `${PK} = :pk AND begins_with(${SK}, :prefix)`,
            ExpressionAttributeValues: { ':pk': `PF#${portfolioId}`, ':prefix': 'ART#' },
        }));
        return (res.Items ?? []).map((i) => i.data as Artifact);
    }

    // ---------- Evidence ----------
    async putEvidence(portfolioId: string, e: Evidence[]): Promise<void> {
        // 기존 evidence 전부 삭제 후 새로 저장
        const old = await this.doc.send(new QueryCommand({
            TableName: this.table,
            KeyConditionExpression: `${PK} = :pk AND begins_with(${SK}, :prefix)`,
            ExpressionAttributeValues: { ':pk': `PF#${portfolioId}`, ':prefix': 'EVD#' },
            ProjectionExpression: `${PK}, ${SK}`,
        }));
        for (const item of old.Items ?? []) {
            await this.doc.send(new DeleteCommand({
                TableName: this.table,
                Key: { [PK]: item[PK], [SK]: item[SK] },
            }));
        }
        for (const ev of e) {
            await this.doc.send(new PutCommand({
                TableName: this.table,
                Item: { [PK]: `PF#${portfolioId}`, [SK]: `EVD#${ev.id}`, type: 'evidence', data: ev },
            }));
        }
    }

    async getEvidence(portfolioId: string): Promise<Evidence[]> {
        const res = await this.doc.send(new QueryCommand({
            TableName: this.table,
            KeyConditionExpression: `${PK} = :pk AND begins_with(${SK}, :prefix)`,
            ExpressionAttributeValues: { ':pk': `PF#${portfolioId}`, ':prefix': 'EVD#' },
        }));
        return (res.Items ?? []).map((i) => i.data as Evidence);
    }

    // ---------- Master ----------
    async putMaster(m: MasterOutput): Promise<void> {
        await this.doc.send(new PutCommand({
            TableName: this.table,
            Item: { [PK]: `PF#${m.portfolioId}`, [SK]: 'OUT#MASTER', type: 'master', data: m },
        }));
    }

    async getMaster(portfolioId: string): Promise<MasterOutput | null> {
        const res = await this.doc.send(new GetCommand({
            TableName: this.table,
            Key: { [PK]: `PF#${portfolioId}`, [SK]: 'OUT#MASTER' },
        }));
        return (res.Item?.data as MasterOutput) ?? null;
    }

    // ---------- Tailored ----------
    async putTailored(t: TailoredOutput): Promise<void> {
        await this.doc.send(new PutCommand({
            TableName: this.table,
            Item: {
                [PK]: `PF#${t.portfolioId}`, [SK]: `OUT#TAILORED#${t.id}`,
                [GSI1PK]: `OUT#${t.id}`, [GSI1SK]: `OUT#${t.id}`,
                type: 'tailored', data: t,
            },
        }));
    }

    async getTailored(portfolioId: string, outputId: string): Promise<TailoredOutput | null> {
        const res = await this.doc.send(new GetCommand({
            TableName: this.table,
            Key: { [PK]: `PF#${portfolioId}`, [SK]: `OUT#TAILORED#${outputId}` },
        }));
        return (res.Item?.data as TailoredOutput) ?? null;
    }

    async getTailoredById(outputId: string): Promise<TailoredOutput | null> {
        const res = await this.doc.send(new QueryCommand({
            TableName: this.table,
            IndexName: GSI_NAME,
            KeyConditionExpression: `${GSI1PK} = :gk`,
            ExpressionAttributeValues: { ':gk': `OUT#${outputId}` },
        }));
        return (res.Items?.[0]?.data as TailoredOutput) ?? null;
    }

    async listTailored(portfolioId: string): Promise<TailoredOutput[]> {
        const res = await this.doc.send(new QueryCommand({
            TableName: this.table,
            KeyConditionExpression: `${PK} = :pk AND begins_with(${SK}, :prefix)`,
            ExpressionAttributeValues: { ':pk': `PF#${portfolioId}`, ':prefix': 'OUT#TAILORED#' },
        }));
        return (res.Items ?? []).map((i) => i.data as TailoredOutput);
    }

    // ---------- Run ----------
    async putRun(r: Run): Promise<void> {
        await this.doc.send(new PutCommand({
            TableName: this.table,
            Item: {
                [PK]: `PF#${r.portfolioId}`, [SK]: `RUN#${r.id}`,
                [GSI1PK]: `RUN#${r.id}`, [GSI1SK]: `RUN#${r.id}`,
                type: 'run', data: r,
            },
        }));
    }

    async getRun(runId: string): Promise<Run | null> {
        const res = await this.doc.send(new QueryCommand({
            TableName: this.table,
            IndexName: GSI_NAME,
            KeyConditionExpression: `${GSI1PK} = :gk`,
            ExpressionAttributeValues: { ':gk': `RUN#${runId}` },
        }));
        return (res.Items?.[0]?.data as Run) ?? null;
    }

    async appendEvent(runId: string, message: string): Promise<void> {
        const run = await this.getRun(runId);
        if (!run) throw new Error(`run 없음: ${runId}`);
        run.events.push({ at: new Date().toISOString(), message });
        await this.putRun(run);
    }

    async setRunStatus(runId: string, status: Run['status']): Promise<void> {
        const run = await this.getRun(runId);
        if (!run) throw new Error(`run 없음: ${runId}`);
        run.status = status;
        await this.putRun(run);
    }

    // ---------- MatchSession ----------
    async putMatchSession(s: MatchSession): Promise<void> {
        await this.doc.send(new PutCommand({
            TableName: this.table,
            Item: {
                [PK]: `PF#${s.portfolioId}`, [SK]: `MATCH#${s.id}`,
                [GSI1PK]: `MATCH#${s.id}`, [GSI1SK]: `MATCH#${s.id}`,
                type: 'match', data: s,
            },
        }));
    }

    async getMatchSession(sessionId: string): Promise<MatchSession | null> {
        const res = await this.doc.send(new QueryCommand({
            TableName: this.table,
            IndexName: GSI_NAME,
            KeyConditionExpression: `${GSI1PK} = :gk`,
            ExpressionAttributeValues: { ':gk': `MATCH#${sessionId}` },
        }));
        return (res.Items?.[0]?.data as MatchSession) ?? null;
    }
}
