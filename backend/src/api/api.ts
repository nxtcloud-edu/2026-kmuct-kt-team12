// backend/src/api/api.ts
// API Lambda: design.md 7장 10개 엔드포인트. CRUD + 실행 접수(202 runId).
// 프레임워크 없이 순수 라우터. API Gateway HTTP API 이벤트(method, path, body)를 받는다.
// Worker 는 JobInvoker 로 비동기 호출한다(응답 30초 제한 회피).
// build/refresh 는 수집(collect)부터 시작하고, 수집이 끝나면 파이프라인을 이어서 부른다.

import type { Deps, JobInvoker } from '../ports.js';
import type { Source, Run, ActivityEntry } from '../../../shared/types.js';
import { prepareFile } from '../collect/collect.js';
import { isMasterNewer } from '../pipeline/tailor.js';

export interface ApiDeps extends Deps {
    jobs: JobInvoker;
}

export interface ApiRequest {
    method: string;
    path: string;
    body?: unknown;
}
export interface ApiResponse {
    status: number;
    body?: unknown;
}

function json(status: number, body?: unknown): ApiResponse {
    return { status, body };
}

/** 경로를 세그먼트로 나눈다. */
function seg(path: string): string[] {
    return path.split('?')[0].split('/').filter(Boolean);
}

async function newRun(deps: ApiDeps, portfolioId: string, mode: Run['mode']): Promise<Run> {
    const run: Run = { id: deps.id.next('run'), portfolioId, mode, status: 'running', events: [] };
    await deps.store.putRun(run);
    return run;
}

/**
 * 10개 엔드포인트 라우팅.
 * POST   /portfolios
 * GET    /portfolios/{id}
 * POST   /portfolios/{id}/sources
 * DELETE /portfolios/{id}/sources/{sourceId}
 * POST   /portfolios/{id}/runs
 * GET    /runs/{runId}
 * PATCH  /portfolios/{id}/entries/{activityId}
 * POST   /portfolios/{id}/outputs
 * GET    /portfolios/{id}/outputs
 * GET    /outputs/{outputId}
 */
export async function handle(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
    const s = seg(req.path);
    const m = req.method.toUpperCase();
    const body = (req.body ?? {}) as Record<string, unknown>;

    try {
        // /portfolios ...
        if (s[0] === 'portfolios') {
            // POST /portfolios
            if (s.length === 1 && m === 'POST') {
                const portfolioId = deps.id.next('pf');
                await deps.store.createPortfolio(portfolioId);
                return json(201, { portfolioId });
            }
            const portfolioId = s[1];

            // GET /portfolios/{id}
            if (s.length === 2 && m === 'GET') {
                const [sources, master, evidence] = await Promise.all([
                    deps.store.getSources(portfolioId),
                    deps.store.getMaster(portfolioId),
                    deps.store.getEvidence(portfolioId),
                ]);
                return json(200, { sources, master, evidence });
            }

            // /portfolios/{id}/sources ...
            if (s[2] === 'sources') {
                // POST /portfolios/{id}/sources
                if (s.length === 3 && m === 'POST') {
                    const kind = body.kind as Source['kind'];
                    const source: Source = {
                        id: deps.id.next('src'),
                        portfolioId,
                        kind,
                        ...(body.url ? { url: body.url as string } : {}),
                        ...(body.fileName ? { fileName: body.fileName as string } : {}),
                        addedAt: deps.clock.now(),
                    };
                    if (kind === 'file') {
                        const { source: updated, uploadUrl } = await prepareFile(
                            source,
                            deps,
                            (body.contentType as string) ?? 'application/octet-stream',
                        );
                        return json(201, { source: updated, uploadUrl });
                    }
                    await deps.store.putSource(source);
                    return json(201, { source });
                }
                // DELETE /portfolios/{id}/sources/{sourceId}
                if (s.length === 4 && m === 'DELETE') {
                    await deps.store.deleteSource(portfolioId, s[3]);
                    return json(204);
                }
            }

            // POST /portfolios/{id}/runs  (build 또는 refresh)
            if (s[2] === 'runs' && s.length === 3 && m === 'POST') {
                const mode = (body.mode as Run['mode']) === 'refresh' ? 'refresh' : 'build';
                const run = await newRun(deps, portfolioId, mode);
                // 수집(collect) 단계부터 시작. 수집이 끝나면 파이프라인을 이어서 부른다.
                await deps.jobs.invoke({ kind: 'collect', mode, portfolioId, runId: run.id });
                return json(202, { runId: run.id });
            }

            // PATCH /portfolios/{id}/entries/{activityId}
            if (s[2] === 'entries' && s.length === 4 && m === 'PATCH') {
                const activityId = s[3];
                const master = await deps.store.getMaster(portfolioId);
                if (!master) return json(404, { error: '마스터 없음' });
                const idx = master.entries.findIndex((e) => e.activityId === activityId);
                if (idx < 0) return json(404, { error: '활동 없음' });

                const patch = body as Partial<ActivityEntry> & { lockedFields?: string[] };
                const prev = master.entries[idx];
                // 수정된 칸을 lockedFields 에 추가
                const changedFields = (patch.lockedFields ?? Object.keys(patch).filter((k) => k !== 'lockedFields'));
                const merged: ActivityEntry = {
                    ...prev,
                    ...patch,
                    activityId, // id 는 불변
                    lockedFields: [...new Set([...prev.lockedFields, ...changedFields])],
                };
                master.entries[idx] = merged;
                await deps.store.putMaster(master);
                return json(200, merged);
            }

            // /portfolios/{id}/outputs ...
            if (s[2] === 'outputs') {
                // POST /portfolios/{id}/outputs (맞춤본 생성 접수)
                if (s.length === 3 && m === 'POST') {
                    const run = await newRun(deps, portfolioId, 'tailor');
                    // tailor 는 수집이 필요 없어 파이프라인(맞춤) 을 바로 부른다.
                    await deps.jobs.invoke({
                        kind: 'tailor',
                        portfolioId,
                        runId: run.id,
                        targetRole: body.targetRole as string,
                        ...(body.jdText ? { jdText: body.jdText as string } : {}),
                        selectedActivityIds: (body.activityIds as string[]) ?? [],
                    });
                    return json(202, { runId: run.id });
                }
                // GET /portfolios/{id}/outputs (목록 요약)
                if (s.length === 3 && m === 'GET') {
                    const master = await deps.store.getMaster(portfolioId);
                    const list = await deps.store.listTailored(portfolioId);
                    const summary = list.map((t) => ({
                        id: t.id,
                        targetRole: t.targetRole,
                        generatedAt: t.generatedAt,
                        stale: master ? isMasterNewer(master, t) : false,
                    }));
                    return json(200, summary);
                }
            }
        }

        // GET /runs/{runId}
        if (s[0] === 'runs' && s.length === 2 && m === 'GET') {
            const run = await deps.store.getRun(s[1]);
            if (!run) return json(404, { error: 'run 없음' });
            return json(200, run);
        }

        // GET /outputs/{outputId}
        if (s[0] === 'outputs' && s.length === 2 && m === 'GET') {
            const found = await deps.store.getTailoredById(s[1]);
            if (!found) return json(404, { error: '맞춤본 없음' });
            return json(200, found);
        }

        return json(404, { error: `라우트 없음: ${m} ${req.path}` });
    } catch (e) {
        return json(500, { error: (e as Error).message });
    }
}
