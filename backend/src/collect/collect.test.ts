// backend/src/collect/collect.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGithubUrl, fetchGithub } from './github.js';
import { fetchWeb, basicHtmlExtractor } from './web.js';
import { parseNotionPageId, fetchNotion } from './notion.js';
import { collect, prepareFile } from './collect.js';
import { mockHttp } from './testkit.js';
import { makeDeps } from '../testkit.js';
import type { Source } from '../../../shared/types.js';

// ---------- URL 파싱 ----------
test('parseGithubUrl: owner/repo 추출', () => {
    assert.deepEqual(parseGithubUrl('https://github.com/torvalds/linux'), {
        owner: 'torvalds',
        repo: 'linux',
    });
    assert.deepEqual(parseGithubUrl('https://github.com/a/b.git'), { owner: 'a', repo: 'b' });
    assert.equal(parseGithubUrl('https://example.com/x/y'), null);
});

test('parseNotionPageId: 32자리 id 를 하이픈 형식으로', () => {
    const id = parseNotionPageId('https://www.notion.so/My-Page-0123456789abcdef0123456789abcdef');
    assert.equal(id, '01234567-89ab-cdef-0123-456789abcdef');
    assert.equal(parseNotionPageId('https://example.com'), null);
});

// ---------- fetchGithub ----------
test('fetchGithub: README/언어/커밋범위를 rawText·meta 로', async () => {
    const readme = Buffer.from('# 프로젝트\n크롤링 문제를 해결했다', 'utf8').toString('base64');
    const http = mockHttp([
        { match: '/repos/o/r/readme', body: JSON.stringify({ content: readme, encoding: 'base64' }) },
        { match: '/repos/o/r/languages', body: JSON.stringify({ TypeScript: 100, CSS: 5 }) },
        {
            match: '/repos/o/r/commits',
            body: JSON.stringify([{ commit: { author: { date: '2026-03-01T00:00:00Z' } } }]),
        },
        { match: '/repos/o/r', body: JSON.stringify({ full_name: 'o/r', description: '설명' }) },
    ]);
    const res = await fetchGithub('https://github.com/o/r', http);
    assert.ok(res.rawText.includes('크롤링 문제를 해결했다'));
    assert.ok(res.rawText.includes('o/r'));
    assert.deepEqual(res.meta.languages, ['TypeScript', 'CSS']);
    assert.equal(res.meta.title, 'o/r');
});

// ---------- fetchWeb ----------
test('fetchWeb: HTML 에서 본문·제목 추출', async () => {
    const html = `<html><head><title>회고</title></head><body>
      <script>console.log('x')</script>
      <p>스터디를 운영했다</p><p>발표를 맡았다</p></body></html>`;
    const http = mockHttp([{ match: 'blog', body: html }]);
    const res = await fetchWeb('https://blog.example.com/post', http);
    assert.equal(res.meta.title, '회고');
    assert.ok(res.rawText.includes('스터디를 운영했다'));
    assert.ok(res.rawText.includes('발표를 맡았다'));
    assert.ok(!res.rawText.includes('console.log'), 'script 내용이 남으면 안 됨');
});

// ---------- fetchNotion ----------
test('fetchNotion: 블록 rich_text 를 이어붙임', async () => {
    const pageUrl = 'https://www.notion.so/0123456789abcdef0123456789abcdef';
    const http = mockHttp([
        {
            match: '/v1/pages/',
            body: JSON.stringify({ properties: { Name: { title: [{ plain_text: '메모' }] } } }),
        },
        {
            match: '/v1/blocks/',
            body: JSON.stringify({
                results: [
                    { type: 'paragraph', paragraph: { rich_text: [{ plain_text: '오늘 API 짰음 ㅋㅋ' }] } },
                    { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: '테스트 통과' }] } },
                ],
                has_more: false,
            }),
        },
    ]);
    const res = await fetchNotion(pageUrl, http, 'secret-token');
    assert.ok(res.rawText.includes('오늘 API 짰음 ㅋㅋ'));
    assert.ok(res.rawText.includes('테스트 통과'));
    assert.equal(res.meta.title, '메모');
});

test('fetchNotion: 토큰 없으면 에러', async () => {
    await assert.rejects(
        fetchNotion('https://www.notion.so/0123456789abcdef0123456789abcdef', mockHttp([]), undefined),
        /토큰/,
    );
});

// ---------- collect end-to-end (T1) ----------
test('collect: 깃허브 URL 1개가 Artifact 로 저장된다 (01-collect T1)', async () => {
    const readme = Buffer.from('첫 커밋', 'utf8').toString('base64');
    const http = mockHttp([
        { match: '/repos/o/r/readme', body: JSON.stringify({ content: readme }) },
        { match: '/repos/o/r/languages', body: JSON.stringify({ TypeScript: 1 }) },
        { match: '/repos/o/r/commits', body: JSON.stringify([{ commit: { author: { date: '2026-01-01T00:00:00Z' } } }]) },
        { match: '/repos/o/r', body: JSON.stringify({ full_name: 'o/r' }) },
    ]);
    const deps = makeDeps({ http });
    await deps.store.createPortfolio('pf-1');
    const source: Source = {
        id: 'src-1',
        portfolioId: 'pf-1',
        kind: 'github',
        url: 'https://github.com/o/r',
        addedAt: deps.clock.now(),
    };
    await deps.store.putSource(source);

    const artifact = await collect(source, deps);
    assert.equal(artifact.sourceId, 'src-1');
    assert.match(artifact.contentHash, /^[0-9a-f]{64}$/);
    assert.equal(artifact.fetchedAt, '2026-09-20T00:00:00.000Z');

    const stored = await deps.store.getArtifacts('pf-1');
    assert.equal(stored.length, 1);
    assert.equal(stored[0].id, artifact.id);
});

test('collect: 4만 자 초과 시 S3 spill', async () => {
    const big = 'a'.repeat(40001);
    const http = mockHttp([{ match: 'blog', body: `<body><p>${big}</p></body>` }]);
    const deps = makeDeps({ http });
    await deps.store.createPortfolio('pf-1');
    const source: Source = {
        id: 'src-web',
        portfolioId: 'pf-1',
        kind: 'web',
        url: 'https://blog.example.com/x',
        addedAt: deps.clock.now(),
    };
    await deps.store.putSource(source);
    const artifact = await collect(source, deps);
    assert.ok(artifact.rawTextS3Key, 'spill 되어야 rawTextS3Key 존재');
    // blob 에 실제로 저장됐는지
    const spilled = await deps.blob.getText(artifact.rawTextS3Key!);
    assert.ok(spilled.length > 40000);
});

test('collect: contentHash 는 같은 입력에 안정적', async () => {
    const http = mockHttp([{ match: 'blog', body: '<body><p>고정 본문</p></body>' }]);
    const source: Source = {
        id: 'src-web',
        portfolioId: 'pf-1',
        kind: 'web',
        url: 'https://blog.example.com/x',
        addedAt: '2026-09-20T00:00:00.000Z',
    };
    const d1 = makeDeps({ http });
    await d1.store.createPortfolio('pf-1');
    await d1.store.putSource(source);
    const a1 = await collect(source, d1);
    const http2 = mockHttp([{ match: 'blog', body: '<body><p>고정 본문</p></body>' }]);
    const d2 = makeDeps({ http: http2 });
    await d2.store.createPortfolio('pf-1');
    await d2.store.putSource(source);
    const a2 = await collect(source, d2);
    assert.equal(a1.contentHash, a2.contentHash);
});

// ---------- prepareFile ----------
test('prepareFile: presigned URL 발급 + s3Key 보관', async () => {
    const deps = makeDeps();
    await deps.store.createPortfolio('pf-1');
    const source: Source = {
        id: 'src-file',
        portfolioId: 'pf-1',
        kind: 'file',
        fileName: '기획서.pdf',
        addedAt: deps.clock.now(),
    };
    const { source: updated, uploadUrl } = await prepareFile(source, deps, 'application/pdf');
    assert.ok(updated.s3Key?.includes('src-file'));
    assert.ok(uploadUrl.startsWith('memory://upload/'));
    const stored = await deps.store.getSources('pf-1');
    assert.equal(stored[0].s3Key, updated.s3Key);
});
