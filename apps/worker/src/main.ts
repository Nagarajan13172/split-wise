import pino from 'pino';
import { Worker, Queue, type ConnectionOptions } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { S3Client } from '@aws-sdk/client-s3';
import { StubOcrProvider } from './ocr/stub-provider.js';
import { TesseractOcrProvider } from './ocr/tesseract-provider.js';
import { processOcrJob, type OcrJobPayload } from './ocr/ocr-processor.js';
import type { OcrProvider } from './ocr/provider.js';

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { singleLine: true } }
      : undefined,
});

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('REDIS_URL is required');

// Parse the URL so we can hand BullMQ a plain options object — keeps the connection
// management inside BullMQ and avoids ioredis version-mismatch type issues.
const parsed = new URL(redisUrl);
const connection: ConnectionOptions = {
  host: parsed.hostname,
  port: Number(parsed.port || 6379),
  password: parsed.password || undefined,
  maxRetriesPerRequest: null,
};

const prisma = new PrismaClient();

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
});

/**
 * Provider selection via OCR_PROVIDER env var.
 *   - 'stub' (default in dev) — returns a deterministic fixture so the full
 *     pipeline (queue → S3 → preprocess → recognize → parse → DB) is exercisable
 *     without installing Tesseract on the host.
 *   - 'tesseract' — shells out to the tesseract CLI (apk add tesseract-ocr in
 *     the worker Dockerfile). Language packs via OCR_LANG (default 'eng').
 */
function buildProvider(): OcrProvider {
  const choice = (process.env.OCR_PROVIDER ?? 'stub').toLowerCase();
  switch (choice) {
    case 'tesseract':
      return new TesseractOcrProvider({ lang: process.env.OCR_LANG ?? 'eng' });
    case 'stub':
      return new StubOcrProvider();
    default:
      throw new Error(`unknown OCR_PROVIDER: ${choice}`);
  }
}
const provider: OcrProvider = buildProvider();

// --- demo queue (kept from phase 0 for boot smoke tests) ---
const demoQueue = new Queue('demo', { connection });
const demoWorker = new Worker(
  'demo',
  async (job) => {
    log.info({ jobId: job.id, name: job.name }, 'demo job processed');
    return { ok: true };
  },
  { connection, concurrency: 1 },
);
demoWorker.on('ready', () => log.info('demo worker ready'));
demoWorker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'demo job failed'));

// --- OCR worker ---
const ocrWorker = new Worker<OcrJobPayload>(
  'ocr',
  async (job) => {
    await processOcrJob({ prisma, s3, provider, log }, job.data);
    return { ok: true };
  },
  { connection, concurrency: 2 },
);
ocrWorker.on('ready', () => log.info({ provider: provider.name }, 'ocr worker ready'));
ocrWorker.on('completed', (job) =>
  log.info({ jobId: job.id, receiptScanId: job.data.receiptScanId }, 'ocr job completed'),
);
ocrWorker.on('failed', (job, err) =>
  log.error({ jobId: job?.id, receiptScanId: job?.data.receiptScanId, err }, 'ocr job failed'),
);

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down worker');
  await Promise.all([demoWorker.close(), ocrWorker.close(), demoQueue.close()]);
  await prisma.$disconnect();
  s3.destroy();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
