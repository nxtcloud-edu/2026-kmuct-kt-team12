// backend/src/collect/collect.ts
// 공통 수집 계층. 어댑터가 만든 rawText 에 대해 해시 계산·spill·저장을 한다. AI 없음(1단계).

import type { Deps } from '../ports.js';
import type { Source, Artifact } from '../../../shared/types.js';
import { sha256 } from '../util.js';
import { fetchGithub, type FetchResult } from './github.js';
import { fetchWeb, type HtmlExtractor, basicHtmlExtractor } from './web.js';
import { fetchNotion } from './notion.js';

export interface CollectOptions {
    htmlExtractor?: HtmlExtractor;
}

/** Source 종류에 맞는 어댑터를 호출해 rawText/meta 를 얻는다. file 은 별도(prepareFile). */
export async function fetchSource(
    source: Source,
    deps: Deps,
    opts: CollectOptions = {},
): Promise<FetchResult> {
    switch (source.kind) {
        case 'github':
            return fetchGithub(source.url!, deps.http, deps.env.GITHUB_TOKEN);
        case 'web':
            return fetchWeb(source.url!, deps.http, opts.htmlExtractor ?? basicHtmlExtractor);
        case 'notion':
            return fetchNotion(source.url!, deps.http, deps.env.NOTION_TOKEN);
        case 'file':
            throw new Error('file 종류는 fetchSource 가 아니라 파일 파이프라인으로 처리한다');
    }
}

/** rawText 가 spill 한도를 넘으면 S3(blob)에 두고 rawTextS3Key 를 채운다. */
async function spillIfLarge(
    deps: Deps,
    artifactId: string,
    rawText: string,
): Promise<{ rawText: string; rawTextS3Key?: string }> {
    if (rawText.length <= deps.env.RAWTEXT_SPILL_LIMIT) return { rawText };
    const key = `rawtext/${artifactId}.txt`;
    await deps.blob.putText(key, rawText);
    // Artifact.rawText 는 계약상 필수라 비울 수 없다. 원문은 S3, 여기엔 앞부분만 둔다.
    return { rawText, rawTextS3Key: key };
}

/**
 * 출처 하나를 수집해 Artifact 를 만들어 저장한다.
 * contentHash 는 항상 전체 rawText 기준으로 계산한다(spill 여부와 무관, 갱신 감지의 기준).
 */
export async function collect(
    source: Source,
    deps: Deps,
    opts: CollectOptions = {},
): Promise<Artifact> {
    const { rawText, meta } = await fetchSource(source, deps, opts);
    const artifactId = deps.id.next('art');
    const contentHash = sha256(rawText);
    const spilled = await spillIfLarge(deps, artifactId, rawText);

    const artifact: Artifact = {
        id: artifactId,
        sourceId: source.id,
        rawText: spilled.rawText,
        ...(spilled.rawTextS3Key ? { rawTextS3Key: spilled.rawTextS3Key } : {}),
        contentHash,
        fetchedAt: deps.clock.now(),
        meta,
    };
    await deps.store.putArtifact(artifact);
    return artifact;
}

/** 파일 출처: presigned PUT URL 을 발급하고 s3Key 를 Source 에 보관한다(업로드는 브라우저가). */
export async function prepareFile(
    source: Source,
    deps: Deps,
    contentType: string,
): Promise<{ source: Source; uploadUrl: string }> {
    const s3Key = `uploads/${source.portfolioId}/${source.id}/${source.fileName ?? 'file'}`;
    const uploadUrl = await deps.blob.presignPut(s3Key, contentType);
    const updated: Source = { ...source, s3Key };
    await deps.store.putSource(updated);
    return { source: updated, uploadUrl };
}
