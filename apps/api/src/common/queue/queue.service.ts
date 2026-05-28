import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue, type ConnectionOptions } from 'bullmq';
import { loadEnv } from '../../config/env.js';

/**
 * Job payload contracts. Keep this list narrow and explicit — the worker has the
 * mirror type and any drift will surface as a TS error in CI.
 */
export interface OcrJobPayload {
  receiptScanId: string;
  /** S3/R2 object key for the uploaded image. */
  objectKey: string;
  /** Bucket name so the worker doesn't need its own bucket config. */
  bucket: string;
  /** ISO content type (e.g. image/jpeg). */
  contentType: string;
}

export const OCR_QUEUE_NAME = 'ocr';

function parseConnection(): ConnectionOptions {
  const url = new URL(loadEnv().REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection = parseConnection();
  readonly ocrQueue = new Queue<OcrJobPayload>(OCR_QUEUE_NAME, {
    connection: this.connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });

  async enqueueOcr(payload: OcrJobPayload): Promise<string> {
    const job = await this.ocrQueue.add('ocr-scan', payload, {
      jobId: payload.receiptScanId,
    });
    return job.id!;
  }

  async onModuleDestroy(): Promise<void> {
    await this.ocrQueue.close();
  }
}
