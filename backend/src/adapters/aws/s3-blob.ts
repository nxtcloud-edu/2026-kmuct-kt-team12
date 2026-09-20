// backend/src/adapters/aws/s3-blob.ts
// S3 어댑터. 큰 원문 저장, presigned PUT URL 발급.

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { BlobPort } from '../../ports.js';

export class S3Blob implements BlobPort {
    private s3: S3Client;
    private bucket: string;

    constructor(bucketName: string, client?: S3Client) {
        this.bucket = bucketName;
        this.s3 = client ?? new S3Client({});
    }

    async putText(key: string, text: string): Promise<void> {
        await this.s3.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: text,
            ContentType: 'text/plain; charset=utf-8',
        }));
    }

    async getText(key: string): Promise<string> {
        const res = await this.s3.send(new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
        }));
        return await res.Body!.transformToString('utf-8');
    }

    async presignPut(key: string, contentType: string): Promise<string> {
        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ContentType: contentType,
        });
        return getSignedUrl(this.s3, command, { expiresIn: 3600 });
    }
}
