import { type PrismaClient } from '@prisma/client';
import { Decimal as PrismaDecimal } from '@prisma/client/runtime/library';
import type { Logger } from 'pino';
import { type Redis } from 'ioredis';
import { fetchLatestRates } from './frankfurter.js';

const FX_CACHE_KEY = 'fx:latest:v1';

export interface FxProcessorDeps {
  prisma: PrismaClient;
  redis: Redis;
  log: Logger;
}

/**
 * Pull latest EUR-base rates from Frankfurter and upsert one FxRate row per
 * quote. Invalidates the API-side Redis cache so the next read picks up the
 * fresh table.
 *
 * Idempotent: the unique key is (base, quote, asOf), so re-running for the
 * same date is a no-op for unchanged rates and updates only what's drifted.
 */
export async function processFxJob(deps: FxProcessorDeps): Promise<{ inserted: number; date: string }> {
  const { prisma, redis, log } = deps;
  const body = await fetchLatestRates();
  const asOf = new Date(`${body.date}T00:00:00Z`);
  let inserted = 0;
  for (const [quote, rate] of Object.entries(body.rates)) {
    await prisma.fxRate.upsert({
      where: { base_quote_asOf: { base: 'EUR', quote, asOf } },
      create: {
        base: 'EUR',
        quote,
        rate: new PrismaDecimal(rate.toString()),
        asOf,
        source: 'frankfurter',
      },
      update: {
        rate: new PrismaDecimal(rate.toString()),
        fetchedAt: new Date(),
      },
    });
    inserted += 1;
  }
  await redis.del(FX_CACHE_KEY).catch(() => null);
  log.info({ date: body.date, quotes: inserted }, 'fx rates upserted');
  return { inserted, date: body.date };
}
