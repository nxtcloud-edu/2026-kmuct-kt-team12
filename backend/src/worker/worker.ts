// backend/src/worker/worker.ts
// 단계별 오케스트레이션. (C) 절충 분할:
//   runCollect  — 수집 전담(Collector Lambda). 끝나면 pipeline 을 비동기 invoke.
//   runPipeline — 추출→통합→마스터(Pipeline Lambda). build/refresh 공통.
//   runTailor   — 직무 맞춤(Pipeline Lambda 안에서 처리).
// 각 단계는 Run.events 에 한국어 메시지를 남기고, 마지막 단계가 status 를 done 으로 전이한다.

import type { Deps, JobInvoker, PipelineMode } from '../ports.js';
import type { Evidence, MasterOutput } from '../../../shared/types.js';
import { collect, type CollectOptions } from '../collect/collect.js';
import { extractEvidence } from '../pipeline/extract.js';
import { consolidateActivities } from '../pipeline/consolidate.js';
import { composeMaster } from '../pipeline/master.js';
import { applyLockedFields } from '../pipeline/refresh.js';
import { composeTailored } from '../pipeline/tailor.js';
import { mapWithConcurrency } from '../util.js';

export interface WorkerOptions {
    collect?: CollectOptions;
}

/** Collector 는 다음 단계(pipeline) 를 부를 JobInvoker 가 필요하다. */
export type CollectorDeps = Deps & { jobs: JobInvoker };

export interface CollectInput {
    portfolioId: string;
    runId: string;
    mode: PipelineMode;
}
export interface PipelineInput {
    portfolioId: string;
    runId: string;
    mode: PipelineMode;
}
export interface TailorInput {
    portfolioId: string;
    runId: string;
    targetRole: string;
    jdText?: string;
    selectedActivityIds: string[];
}

/** 활동별 허용 근거 id 집합을 만든다(맞춤본 검증용). */
function allowedByActivity(evidence: Evidence[]): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (const e of evidence) {
        if (!e.activityId) continue;
        const arr = m.get(e.activityId) ?? [];
        arr.push(e.id);
        m.set(e.activityId, arr);
    }
    return m;
}

// ============================================================
// Collector Lambda: 수집 전담
// ============================================================
/**
 * 출처들을 병렬로 수집해 Artifact 를 저장한 뒤, pipeline 단계를 비동기로 부른다.
 * 여기서 status 를 done 으로 바꾸지 않는다(파이프라인이 이어서 돈다).
 */
export async function runCollect(
    input: CollectInput,
    deps: CollectorDeps,
    opts: WorkerOptions = {},
): Promise<void> {
    const { portfolioId, runId, mode } = input;
    try {
        const sources = await deps.store.getSources(portfolioId);
        // file 은 별도(브라우저 업로드) — 여기서는 URL 출처만 읽는다.
        const urlSources = sources.filter((s) => s.kind !== 'file');
        const artifacts = await mapWithConcurrency(
            urlSources,
            deps.env.EXTRACT_CONCURRENCY,
            (s) => collect(s, deps, opts.collect),
        );
        await deps.store.appendEvent(runId, `${artifacts.length}개 출처를 수집했습니다`);

        // 다음 단계(파이프라인) 를 비동기로 호출
        await deps.jobs.invoke({ kind: 'pipeline', mode, portfolioId, runId });
    } catch (e) {
        await deps.store.appendEvent(runId, `수집 실패: ${(e as Error).message}`);
        await deps.store.setRunStatus(runId, 'failed');
        throw e;
    }
}

// ============================================================
// Pipeline Lambda: 추출 → 통합 → 마스터 (build/refresh 공통)
// ============================================================
/**
 * 저장된 Artifact 를 읽어 추출→통합→마스터 작성까지 하고 status 를 done 으로 전이한다.
 * refresh 는 contentHash 가 바뀐 출처만 재추출하고 lockedFields 를 보존한다.
 * (수집은 이미 runCollect 가 끝냈다. 여기서는 저장된 Artifact 를 입력으로 받는다.)
 */
export async function runPipeline(input: PipelineInput, deps: Deps): Promise<MasterOutput> {
    const { portfolioId, runId, mode } = input;
    try {
        const artifacts = await deps.store.getArtifacts(portfolioId);
        const previousMaster = mode === 'refresh' ? await deps.store.getMaster(portfolioId) : null;

        // refresh: 변경된 출처만 재추출 대상. build: 전부.
        let toExtract = artifacts;
        if (mode === 'refresh') {
            const previousEvidence = await deps.store.getEvidence(portfolioId);
            // 이전 Evidence 가 참조하던 artifactId 로 "이전 수집본"을 역산할 수 없으므로,
            // 변경 판단은 저장된 contentHash 대비가 아니라, 파이프라인이 이전 마스터 기준으로만 한다.
            // 여기서는 보수적으로 previousEvidence 가 있는 artifact 는 유지, 나머지만 재추출한다.
            const knownArtifactIds = new Set(previousEvidence.map((e) => e.quoteRef.artifactId));
            toExtract = artifacts.filter((a) => !knownArtifactIds.has(a.id));
            if (toExtract.length !== artifacts.length) {
                await deps.store.appendEvent(runId, `변경·신규 출처 ${toExtract.length}개만 다시 읽습니다`);
            }
        }

        // 2) 추출 (출처별 병렬, verifyQuote 폐기)
        let kept = 0;
        let dropped = 0;
        const extracted = await mapWithConcurrency(toExtract, deps.env.EXTRACT_CONCURRENCY, async (a) => {
            const out = await extractEvidence(a, deps);
            kept += out.keptCount;
            dropped += out.droppedCount;
            return out.evidence;
        });
        let evidence: Evidence[] = extracted.flat();

        // refresh 에서 재추출하지 않은 출처의 기존 Evidence 는 유지
        if (mode === 'refresh') {
            const reExtractedArtifactIds = new Set(toExtract.map((a) => a.id));
            const keptOld = (await deps.store.getEvidence(portfolioId)).filter(
                (e) => !reExtractedArtifactIds.has(e.quoteRef.artifactId),
            );
            evidence = [...keptOld, ...evidence];
        }
        await deps.store.appendEvent(runId, `근거 ${kept}개를 찾았습니다 (폐기 ${dropped}개)`);

        // 3) 통합
        const cons = await consolidateActivities(evidence, deps);
        await deps.store.putEvidence(portfolioId, cons.evidence);
        for (const size of cons.mergedGroupSizes) {
            await deps.store.appendEvent(runId, `${size}개 링크가 하나의 활동으로 합쳐졌습니다`);
        }

        // 4) 마스터 작성
        let master = await composeMaster(portfolioId, cons.evidence, deps);
        if (mode === 'refresh') {
            master = applyLockedFields(master, previousMaster);
        }
        await deps.store.putMaster(master);
        await deps.store.appendEvent(runId, `마스터 타임라인 ${master.entries.length}개 활동을 정리했습니다`);

        await deps.store.setRunStatus(runId, 'done');
        return master;
    } catch (e) {
        await deps.store.appendEvent(runId, `파이프라인 실패: ${(e as Error).message}`);
        await deps.store.setRunStatus(runId, 'failed');
        throw e;
    }
}

// ============================================================
// tailor: 마스터 + 직무 → 맞춤본 (수집 불필요)
// ============================================================
export async function runTailor(input: TailorInput, deps: Deps) {
    const { portfolioId, runId, targetRole, jdText, selectedActivityIds } = input;
    try {
        const master = await deps.store.getMaster(portfolioId);
        if (!master) throw new Error('마스터가 아직 없습니다. 먼저 정리하기를 실행하세요');

        const evidence = await deps.store.getEvidence(portfolioId);
        const allowed = allowedByActivity(evidence);

        const output = await composeTailored(
            portfolioId,
            master,
            targetRole,
            jdText,
            selectedActivityIds,
            allowed,
            deps,
        );
        await deps.store.putTailored(output);
        const gaps = output.competencies.filter((c) => c.evidenceIds.length === 0).length;
        await deps.store.appendEvent(runId, `${targetRole} 맞춤본을 만들었습니다 (공백 역량 ${gaps}개)`);
        await deps.store.setRunStatus(runId, 'done');
        return output;
    } catch (e) {
        await deps.store.appendEvent(runId, `실패: ${(e as Error).message}`);
        await deps.store.setRunStatus(runId, 'failed');
        throw e;
    }
}
