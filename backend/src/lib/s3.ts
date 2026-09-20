// backend/src/lib/s3.ts
// S3 접근. 리전 us-east-1 고정. SDK는 런타임에서만 로드.
// - putSiteHtml: ai-worker 가 index.html 업로드
// - readSiteHtml: api 가 /sites/{id} 응답용으로 읽음

export const REGION = 'us-east-1';

export function siteKey(sessionId: string): string {
  return `sites/${sessionId}/index.html`;
}

interface S3Cmds {
  client: { send(cmd: unknown): Promise<unknown> };
  Put: any;
  Get: any;
}

let cached: S3Cmds | null = null;
async function s3(): Promise<S3Cmds> {
  if (cached) return cached;
  const mod = await import('@aws-sdk/client-s3');
  const client = new mod.S3Client({ region: REGION });
  cached = { client: client as any, Put: mod.PutObjectCommand, Get: mod.GetObjectCommand };
  return cached;
}

export async function putSiteHtml(bucket: string, sessionId: string, html: string): Promise<string> {
  const key = siteKey(sessionId);
  const s = await s3();
  await s.client.send(
    new s.Put({
      Bucket: bucket,
      Key: key,
      Body: html,
      ContentType: 'text/html; charset=utf-8',
    }),
  );
  return key;
}

export async function readSiteHtml(bucket: string, sessionId: string): Promise<string | undefined> {
  const s = await s3();
  try {
    const res = (await s.client.send(
      new s.Get({ Bucket: bucket, Key: siteKey(sessionId) }),
    )) as { Body?: { transformToString(): Promise<string> } };
    if (!res.Body) return undefined;
    return await res.Body.transformToString();
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'NoSuchKey' || name === 'NotFound') return undefined;
    throw e;
  }
}
