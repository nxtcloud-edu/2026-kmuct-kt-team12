// backend/build.mjs
// esbuild 로 각 Lambda 핸들러를 단일 파일로 번들링 후 ZIP 생성.
// 실행: node build.mjs → lambda-dist/ 에 api.zip, collector.zip, pipeline.zip 생성.

import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';

const OUT_DIR = 'lambda-dist';
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR);

const handlers = [
    { name: 'api', entry: 'src/handlers/api.ts' },
    { name: 'collector', entry: 'src/handlers/collector.ts' },
    { name: 'pipeline', entry: 'src/handlers/pipeline.ts' },
];

for (const h of handlers) {
    const outfile = `${OUT_DIR}/${h.name}/index.mjs`;

    await build({
        entryPoints: [h.entry],
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'esm',
        outfile,
        external: [
            '@aws-sdk/client-dynamodb',
            '@aws-sdk/lib-dynamodb',
            '@aws-sdk/client-s3',
            '@aws-sdk/s3-request-presigner',
            '@aws-sdk/client-bedrock-runtime',
            '@aws-sdk/client-lambda',
        ],
        banner: {
            // ESM 에서 __dirname 등이 필요할 때 대비
            js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
        },
    });

    // ZIP 생성
    execSync(`cd ${OUT_DIR}/${h.name} && zip -r ../${h.name}.zip index.mjs`, { stdio: 'inherit' });
    console.log(`✓ ${h.name}.zip 생성 완료`);
}

console.log('\n모든 Lambda ZIP 파일이 lambda-dist/ 에 생성되었습니다.');
console.log('콘솔에서 각 Lambda 함수 → 코드 → .zip 파일 업로드 로 올리세요.');
console.log('핸들러 설정: index.handler');
