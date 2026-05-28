import { Injectable } from '@nestjs/common';
import { S3Client, DeleteObjectCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadEnv } from '../../config/env.js';

@Injectable()
export class S3Service {
  readonly client: S3Client;
  private readonly env = loadEnv();

  constructor() {
    this.client = new S3Client({
      endpoint: this.env.S3_ENDPOINT,
      region: this.env.S3_REGION,
      credentials: {
        accessKeyId: this.env.S3_ACCESS_KEY_ID,
        secretAccessKey: this.env.S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: this.env.S3_FORCE_PATH_STYLE,
    });
  }

  get receiptsBucket(): string {
    return this.env.S3_BUCKET_RECEIPTS;
  }

  get avatarsBucket(): string {
    return this.env.S3_BUCKET_AVATARS;
  }

  /** Generate a presigned URL the client uses to upload directly to S3/R2/MinIO. */
  async presignUpload(opts: {
    bucket: string;
    key: string;
    contentType: string;
    expiresInSeconds?: number;
  }): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: opts.bucket,
      Key: opts.key,
      ContentType: opts.contentType,
    });
    return getSignedUrl(this.client, cmd, {
      expiresIn: opts.expiresInSeconds ?? 60 * 10,
    });
  }

  /** Presigned URL the client (or worker) uses to GET an object. */
  async presignDownload(opts: {
    bucket: string;
    key: string;
    expiresInSeconds?: number;
  }): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: opts.bucket, Key: opts.key });
    return getSignedUrl(this.client, cmd, {
      expiresIn: opts.expiresInSeconds ?? 60 * 10,
    });
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}
