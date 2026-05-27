import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_BASE_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_RECEIPTS: z.string().min(1),
  S3_BUCKET_AVATARS: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  cached = parsed.data;
  return cached;
}
