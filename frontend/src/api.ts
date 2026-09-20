// src/api.ts
// API 클라이언트. shared/types.ts 타입으로 응답을 다룬다.
// 환경 플래그(VITE_USE_MOCK)로 목(fixtures)↔실제(fetch) 전환. 기본은 목(AWS 없이 동작).

import type {
    Source,
    Artifact,
    Evidence,
    MasterOutput,
    TailoredOutput,
    Run,
} from '@shared/types';
import {
    fixtureArtifacts,
    fixtureEvidence,
    fixtureMaster,
    fixtureTailored,
    fixtureSources,
    fixtureRunDone,
} from './fixtures';

export interface PortfolioView {
    sources: Source[];
    master: MasterOutput | null;
    evidence: Evidence[];
}

export interface TailoredSummary {
    id: string;
    targetRole: string;
    generatedAt: string;
    stale: boolean;
}

export interface Api {
    createPortfolio(): Promise<string>;
    getPortfolio(id: string): Promise<PortfolioView>;
    addSource(id: string, input: { kind: Source['kind']; url?: string; fileName?: string; contentType?: string }): Promise<{ source: Source; uploadUrl?: string }>;
    deleteSource(id: string, sourceId: string): Promise<void>;
    startRun(id: string, mode: 'build' | 'refresh'): Promise<string>;
    getRun(runId: string): Promise<Run>;
    patchEntry(id: string, activityId: string, patch: Record<string, unknown>): Promise<void>;
    createOutput(id: string, input: { targetRole: string; jdText?: string; activityIds: string[] }): Promise<string>;
    listOutputs(id: string): Promise<TailoredSummary[]>;
    getOutput(outputId: string): Promise<TailoredOutput>;
    /** 근거 추적: artifact 원문을 얻는다(목 전용/데모). 실제는 getPortfolio 응답에 포함하거나 별도 조회. */
    getArtifacts(id: string): Promise<Artifact[]>;
}

// ---------- 목 구현 ----------
function delay<T>(v: T, ms = 120): Promise<T> {
    return new Promise((r) => setTimeout(() => r(v), ms));
}

export function createMockApi(): Api {
    // 데모 상태(메모리). 실제 백엔드 없이 화면 흐름을 흉내낸다.
    const master = structuredClone(fixtureMaster);
    let outputs: TailoredOutput[] = [structuredClone(fixtureTailored)];
    const sources = structuredClone(fixtureSources);

    return {
        async createPortfolio() {
            return delay('pf-demo');
        },
        async getPortfolio() {
            return delay({ sources, master, evidence: structuredClone(fixtureEvidence) });
        },
        async addSource(_id, input) {
            const src: Source = {
                id: `src-${Date.now()}`,
                portfolioId: 'pf-demo',
                kind: input.kind,
                ...(input.url ? { url: input.url } : {}),
                ...(input.fileName ? { fileName: input.fileName } : {}),
                addedAt: new Date().toISOString(),
            };
            sources.push(src);
            return delay({ source: src, ...(input.kind === 'file' ? { uploadUrl: `memory://upload/${src.id}` } : {}) });
        },
        async deleteSource(_id, sourceId) {
            const i = sources.findIndex((s) => s.id === sourceId);
            if (i >= 0) sources.splice(i, 1);
            return delay(undefined);
        },
        async startRun() {
            return delay('run-demo');
        },
        async getRun() {
            return delay(structuredClone(fixtureRunDone));
        },
        async patchEntry(_id, activityId, patch) {
            const e = master.entries.find((x) => x.activityId === activityId);
            if (e) {
                Object.assign(e, patch);
                const changed = Object.keys(patch).filter((k) => k !== 'lockedFields');
                e.lockedFields = [...new Set([...e.lockedFields, ...changed])];
            }
            return delay(undefined);
        },
        async createOutput(_id, input) {
            const out = structuredClone(fixtureTailored);
            out.id = `out-${Date.now()}`;
            out.targetRole = input.targetRole;
            if (input.jdText) out.jdText = input.jdText;
            outputs = [out, ...outputs];
            return delay(out.id);
        },
        async listOutputs() {
            return delay(
                outputs.map((o) => ({
                    id: o.id,
                    targetRole: o.targetRole,
                    generatedAt: o.generatedAt,
                    stale: master.generatedAt > o.basedOnMasterAt,
                })),
            );
        },
        async getOutput(outputId) {
            const o = outputs.find((x) => x.id === outputId) ?? outputs[0];
            return delay(structuredClone(o));
        },
        async getArtifacts() {
            return delay(structuredClone(fixtureArtifacts));
        },
    };
}

// ---------- 실제(fetch) 구현 ----------
export function createHttpApi(baseUrl: string): Api {
    async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
        const res = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!res.ok) throw new Error(`${method} ${path} 실패: ${res.status}`);
        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
    }
    return {
        async createPortfolio() {
            return (await req<{ portfolioId: string }>('POST', '/portfolios')).portfolioId;
        },
        getPortfolio: (id) => req('GET', `/portfolios/${id}`),
        addSource: (id, input) => req('POST', `/portfolios/${id}/sources`, input),
        deleteSource: (id, sourceId) => req('DELETE', `/portfolios/${id}/sources/${sourceId}`),
        async startRun(id, mode) {
            return (await req<{ runId: string }>('POST', `/portfolios/${id}/runs`, { mode })).runId;
        },
        getRun: (runId) => req('GET', `/runs/${runId}`),
        patchEntry: (id, activityId, patch) => req('PATCH', `/portfolios/${id}/entries/${activityId}`, patch),
        async createOutput(id, input) {
            return (await req<{ runId: string }>('POST', `/portfolios/${id}/outputs`, {
                targetRole: input.targetRole,
                jdText: input.jdText,
                activityIds: input.activityIds,
            })).runId;
        },
        listOutputs: (id) => req('GET', `/portfolios/${id}/outputs`),
        getOutput: (outputId) => req('GET', `/outputs/${outputId}`),
        async getArtifacts(id) {
            // 실제 백엔드는 getPortfolio 에 evidence 만 주므로, 원문은 별도 엔드포인트가 필요.
            // 지금은 빈 배열(추후 GET /portfolios/{id}/artifacts 추가 시 연결).
            void id;
            return [];
        },
    };
}

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';
const BASE_URL = import.meta.env.VITE_API_BASE ?? '';

export const api: Api = USE_MOCK ? createMockApi() : createHttpApi(BASE_URL);
