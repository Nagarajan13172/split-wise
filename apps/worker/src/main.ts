import pino from 'pino';
import { Worker, Queue, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { S3Client } from '@aws-sdk/client-s3';
import { StubOcrProvider } from './ocr/stub-provider.js';
import { TesseractOcrProvider } from './ocr/tesseract-provider.js';
import { processOcrJob, type OcrJobPayload } from './ocr/ocr-processor.js';
import type { OcrProvider } from './ocr/provider.js';
import { processFxJob } from './fx/fx-processor.js';

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

// Side-channel Redis client used by the FX processor to invalidate the API
// cache key after each write. Keeping it separate from BullMQ's own pool so
// that closing the queues doesn't kick the regular client mid-call.
const redis = new Redis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: 3 });

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

// --- FX cron: Frankfurter publishes once daily ~16:00 CET; we re-pull at
// 16:30 UTC which is ~17:30 CET / ~18:30 CEST — comfortably after publish.
// Cron is configurable via FX_CRON for tests / local fixtures.
const FX_CRON = process.env.FX_CRON ?? '30 16 * * *';
const fxQueue = new Queue('fx', { connection });
const fxWorker = new Worker(
  'fx',
  async (job) => {
    log.info({ jobId: job.id, name: job.name }, 'fx job processing');
    return processFxJob({ prisma, redis, log });
  },
  { connection, concurrency: 1 },
);
fxWorker.on('ready', () => log.info({ cron: FX_CRON }, 'fx worker ready'));
fxWorker.on('completed', (job, result) =>
  log.info({ jobId: job.id, result }, 'fx job completed'),
);
fxWorker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'fx job failed'));

async function ensureFxCron(): Promise<void> {
  // Drop any pre-existing repeats so a changed cron actually takes effect.
  const existing = await fxQueue.getRepeatableJobs();
  for (const r of existing) await fxQueue.removeRepeatableByKey(r.key);
  await fxQueue.add('fx-daily', null, { repeat: { pattern: FX_CRON, tz: 'UTC' } });

  // First-run priming: if there are zero FxRate rows yet, kick a job now so a
  // fresh dev environment has rates without waiting up to 24h.
  const count = await prisma.fxRate.count();
  if (count === 0) {
    log.info('no FxRate rows yet — priming fx pull now');
    await fxQueue.add('fx-prime', null);
  }
}
void ensureFxCron().catch((err) => log.error({ err }, 'fx cron setup failed'));

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down worker');
  await Promise.all([
    demoWorker.close(),
    ocrWorker.close(),
    fxWorker.close(),
    demoQueue.close(),
    fxQueue.close(),
  ]);
  await prisma.$disconnect();
  await redis.quit().catch(() => null);
  s3.destroy();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
