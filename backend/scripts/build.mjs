// backend/scripts/build.mjs
// esbuild 로 api / collector / ai-worker 를 각각 단일 index.mjs 로 번들(platform node, format esm,
// target node20, AWS SDK 포함) → archiver 로 dist/{api,collector,ai-worker}.zip 생성.
// zip 루트에 index.mjs. 핸들러는 index.handler. OS 비의존 Node 스크립트.

import { build } from 'esbuild';
import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const TARGETS = [
  { name: 'api', entry: 'src/api/index.ts', zip: 'api.zip' },
  { name: 'collector', entry: 'src/collector/index.ts', zip: 'collector.zip' },
  { name: 'ai-worker', entry: 'src/aiworker/index.ts', zip: 'ai-worker.zip' },
];

async function bundleOne(t) {
  const outdir = join(dist, t.name);
  await build({
    entryPoints: [join(root, t.entry)],
    outfile: join(outdir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    // AWS SDK 를 번들에 포함(명세). ESM 번들에서 require 사용 shim.
    banner: {
      js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
    },
    logLevel: 'warning',
  });
  return outdir;
}

function zipDir(srcDir, zipPath) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(archive.pointer()));
    archive.on('error', reject);
    archive.pipe(output);
    // zip 루트에 index.mjs 가 오도록 디렉터리 내용물을 루트로 넣는다.
    archive.directory(srcDir, false);
    archive.finalize();
  });
}

async function main() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  for (const t of TARGETS) {
    process.stdout.write(`번들: ${t.name} … `);
    const outdir = await bundleOne(t);
    const zipPath = join(dist, t.zip);
    const bytes = await zipDir(outdir, zipPath);
    console.log(`${t.zip} (${(bytes / 1024).toFixed(0)} KB)`);
  }
  console.log('완료: dist/api.zip, dist/collector.zip, dist/ai-worker.zip');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
