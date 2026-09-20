// backend/src/adapters/memory.ts
// AWS 없이 도는 인메모리 어댑터. 테스트와 로컬 개발용.
// DynamoDB 단일 테이블 의미(PK=PF#{portfolioId}, SK 종류별)를 메모리로 흉내낸다.

import type { StorePort, BlobPort } from '../ports.js';
import type {
    Source,
    Artifact,
    Evidence,
    MasterOutput,
    TailoredOutput,
    Run,
} from '../../../shared/types.js';

export class MemoryStore implements StorePort {
    private portfolios = new Set<string>();
    private sources = new Map<string, Source[]>();
    private artifacts = new Map<string, Artifact[]>();
    private evidence = new Map<string, Evidence[]>();
    private master = new Map<string, MasterOutput>();
    private tailored = new Map<string, Map<string, TailoredOutput>>();
    private runs = new Map<string, Run>();

    async createPortfolio(portfolioId: string): Promise<void> {
        this.portfolios.add(portfolioId);
        if (!this.sources.has(portfolioId)) this.sources.set(portfolioId, []);
    }

    async putSource(s: Source): Promise<void> {
        const arr = this.sources.get(s.portfolioId) ?? [];
        const idx = arr.findIndex((x) => x.id === s.id);
        if (idx >= 0) arr[idx] = s;
        else arr.push(s);
        this.sources.set(s.portfolioId, arr);
    }
    async getSources(portfolioId: string): Promise<Source[]> {
        return [...(this.sources.get(portfolioId) ?? [])];
    }
    async deleteSource(portfolioId: string, sourceId: string): Promise<void> {
        this.sources.set(
            portfolioId,
            (this.sources.get(portfolioId) ?? []).filter((s) => s.id !== sourceId),
        );
        this.artifacts.set(
            portfolioId,
            (this.artifacts.get(portfolioId) ?? []).filter((a) => a.sourceId !== sourceId),
        );
    }

    async putArtifact(a: Artifact): Promise<void> {
        const pid = this.portfolioOfArtifact(a);
        const arr = this.artifacts.get(pid) ?? [];
        const idx = arr.findIndex((x) => x.id === a.id);
        if (idx >= 0) arr[idx] = a;
        else arr.push(a);
        this.artifacts.set(pid, arr);
    }
    async getArtifacts(portfolioId: string): Promise<Artifact[]> {
        return [...(this.artifacts.get(portfolioId) ?? [])];
    }

    async putEvidence(portfolioId: string, e: Evidence[]): Promise<void> {
        this.evidence.set(portfolioId, [...e]);
    }
    async getEvidence(portfolioId: string): Promise<Evidence[]> {
        return [...(this.evidence.get(portfolioId) ?? [])];
    }

    async putMaster(m: MasterOutput): Promise<void> {
        this.master.set(m.portfolioId, m);
    }
    async getMaster(portfolioId: string): Promise<MasterOutput | null> {
        return this.master.get(portfolioId) ?? null;
    }

    async putTailored(t: TailoredOutput): Promise<void> {
        const m = this.tailored.get(t.portfolioId) ?? new Map<string, TailoredOutput>();
        m.set(t.id, t);
        this.tailored.set(t.portfolioId, m);
    }
    async getTailored(portfolioId: string, outputId: string): Promise<TailoredOutput | null> {
        return this.tailored.get(portfolioId)?.get(outputId) ?? null;
    }
    async getTailoredById(outputId: string): Promise<TailoredOutput | null> {
        for (const m of this.tailored.values()) {
            const t = m.get(outputId);
            if (t) return t;
        }
        return null;
    }
    async listTailored(portfolioId: string): Promise<TailoredOutput[]> {
        return [...(this.tailored.get(portfolioId)?.values() ?? [])];
    }

    async putRun(r: Run): Promise<void> {
        this.runs.set(r.id, structuredClone(r));
    }
    async getRun(runId: string): Promise<Run | null> {
        const r = this.runs.get(runId);
        return r ? structuredClone(r) : null;
    }
    async appendEvent(runId: string, message: string): Promise<void> {
        const r = this.runs.get(runId);
        if (!r) throw new Error(`run 없음: ${runId}`);
        r.events.push({ at: new Date().toISOString(), message });
    }
    async setRunStatus(runId: string, status: Run['status']): Promise<void> {
        const r = this.runs.get(runId);
        if (!r) throw new Error(`run 없음: ${runId}`);
        r.status = status;
    }

    // Artifact 는 sourceId 만 갖고 portfolioId 를 직접 안 갖는다.
    // sources 맵을 역참조해 소속 포트폴리오를 찾는다.
    private portfolioOfArtifact(a: Artifact): string {
        for (const [pid, arr] of this.sources) {
            if (arr.some((s) => s.id === a.sourceId)) return pid;
        }
        // 소스가 아직 없으면(테스트에서 직접 artifact 를 넣는 경우) sourceId 접두사로 추정하지 않고 예외
        throw new Error(`artifact ${a.id} 의 소속 포트폴리오를 찾을 수 없음 (sourceId=${a.sourceId})`);
    }
}

export class MemoryBlob implements BlobPort {
    private store = new Map<string, string>();

    async putText(key: string, text: string): Promise<void> {
        this.store.set(key, text);
    }
    async getText(key: string): Promise<string> {
        const v = this.store.get(key);
        if (v === undefined) throw new Error(`blob 없음: ${key}`);
        return v;
    }
    async presignPut(key: string, contentType: string): Promise<string> {
        // 인메모리에서는 가짜 URL 을 돌려준다. 실제 업로드는 테스트에서 putText 로 대체.
        return `memory://upload/${encodeURIComponent(key)}?ct=${encodeURIComponent(contentType)}`;
    }
}
