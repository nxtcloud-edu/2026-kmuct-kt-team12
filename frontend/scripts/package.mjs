// frontend/scripts/package.mjs
// dist/ 내용물을 루트로 하는 site.zip 생성. Amplify 수동 배포용.
//
// frontend 허용 의존성 목록에 archiver 가 없으므로, Node 내장 zlib 만으로
// 표준 ZIP(deflate) 파일을 직접 작성한다. 외부 의존성 0.
// ponytail: ZIP64 미지원(4GB 이상/65535개 이상 엔트리 불가). 프론트 정적 산출물엔 충분.

import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const zipPath = join(root, 'site.zip');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let files;
try {
  files = walk(dist);
} catch {
  console.error('dist/ 가 없습니다. 먼저 `npm run build` 를 실행하세요.');
  process.exit(1);
}

const enc = new TextEncoder();
const chunks = [];
const central = [];
let offset = 0;

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0, 0);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

for (const full of files) {
  // zip 내부 경로: dist 기준 상대경로, 슬래시 구분
  const nameStr = relative(dist, full).split(sep).join('/');
  const nameBuf = Buffer.from(enc.encode(nameStr));
  const data = readFileSync(full);
  const crc = crc32(data) >>> 0;
  const deflated = deflateRawSync(data);
  const method = 8; // deflate

  const localHeader = Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(0x0800), // UTF-8 filename flag
    u16(method),
    u16(0),
    u16(0), // dos time/date (0)
    u32(crc),
    u32(deflated.length),
    u32(data.length),
    u16(nameBuf.length),
    u16(0),
    nameBuf,
  ]);
  chunks.push(localHeader, deflated);

  const centralHeader = Buffer.concat([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0x0800),
    u16(method),
    u16(0),
    u16(0),
    u32(crc),
    u32(deflated.length),
    u32(data.length),
    u16(nameBuf.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(offset),
    nameBuf,
  ]);
  central.push(centralHeader);

  offset += localHeader.length + deflated.length;
}

const centralBuf = Buffer.concat(central);
const eocd = Buffer.concat([
  u32(0x06054b50),
  u16(0),
  u16(0),
  u16(files.length),
  u16(files.length),
  u32(centralBuf.length),
  u32(offset),
  u16(0),
]);

const zip = Buffer.concat([...chunks, centralBuf, eocd]);
writeFileSync(zipPath, zip);
console.log(`site.zip 생성 (${(zip.length / 1024).toFixed(0)} KB, 파일 ${files.length}개)`);
