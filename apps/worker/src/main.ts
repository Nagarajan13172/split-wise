import pino from 'pino';
import { Worker, Queue, type ConnectionOptions } from 'bullmq';

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

// Phase-0 stub: a single demo queue so we can verify workers boot and connect to Redis.
// Real processors (ocr, fx-refresh, recurring, push-fanout, weekly-digest) land in their phases.
const demoQueue = new Queue('demo', { connection });

const demoWorker = new Worker(
  'demo',
  async (job) => {
    log.info({ jobId: job.id, name: job.name }, 'demo job processed');
    return { ok: true };
  },
  { connection, concurrency: 1 },
);

demoWorker.on('ready', () => log.info('worker ready, listening on queue "demo"'));
demoWorker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'job failed'));

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down worker');
  await demoWorker.close();
  await demoQueue.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
