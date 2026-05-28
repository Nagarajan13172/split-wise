import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  D,
  convert,
  toConvertedAmount,
  type Decimal as SharedDecimal,
  type FxTable,
  type ConvertedAmount,
} from '@split-wise/shared';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RedisService } from '../../common/redis/redis.service.js';

const REDIS_KEY = 'fx:latest:v1';
const REDIS_TTL_SECONDS = 6 * 60 * 60; // 6h — Frankfurter publishes once a day
const LRU_TTL_MS = 60 * 1000; // 1m — keeps hot reads off Redis

interface CachedTable {
  base: string;
  /** quote → string-encoded rate */
  rates: Record<string, string>;
  /** ISO date of the latest rate fetch (max(asOf) across rows). */
  asOf: string;
}

/**
 * FX read service. Reads the latest snapshot of FxRate rows (one per quote)
 * from Postgres, caches in Redis (cross-process) + a tiny in-process LRU
 * (single-process hot path).
 *
 * Writes (Frankfurter pull) happen in the worker — this service is read-only.
 */
@Injectable()
export class FxService {
  private readonly log = new Logger(FxService.name);
  private lruCache: { table: CachedTable; expiresAt: number } | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /** Latest base→quote table, with EUR base (matches Frankfurter). */
  async latestTable(): Promise<FxTable | null> {
    const cached = await this.cachedTable();
    if (!cached) return null;
    return { base: cached.base, rates: cached.rates };
  }

  /** Latest table plus the asOf timestamp — for UI "rates from {date}" labels. */
  async latestSnapshot(): Promise<{ table: FxTable; asOf: string } | null> {
    const cached = await this.cachedTable();
    if (!cached) return null;
    return { table: { base: cached.base, rates: cached.rates }, asOf: cached.asOf };
  }

  async convert(amount: string, from: string, to: string): Promise<SharedDecimal | null> {
    if (from === to) return D(amount);
    const table = await this.latestTable();
    if (!table) return null;
    try {
      return convert(amount, from, to, table);
    } catch {
      return null;
    }
  }

  async toConverted(amount: string, currency: string, homeCurrency: string): Promise<ConvertedAmount> {
    const table = await this.latestTable();
    return toConvertedAmount(amount, currency, homeCurrency, table);
  }

  /** Invalidate caches — call this after the worker writes new rates. */
  async invalidate(): Promise<void> {
    this.lruCache = null;
    await this.redis.client.del(REDIS_KEY).catch(() => null);
  }

  // ---------------- internals ----------------

  private async cachedTable(): Promise<CachedTable | null> {
    const now = Date.now();
    if (this.lruCache && this.lruCache.expiresAt > now) return this.lruCache.table;

    const raw = await this.redis.client.get(REDIS_KEY).catch(() => null);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as CachedTable;
        this.lruCache = { table: parsed, expiresAt: now + LRU_TTL_MS };
        return parsed;
      } catch {
        /* fall through and re-pull */
      }
    }

    const table = await this.loadFromDb();
    if (table) {
      await this.redis.client.setex(REDIS_KEY, REDIS_TTL_SECONDS, JSON.stringify(table)).catch(() => null);
      this.lruCache = { table, expiresAt: now + LRU_TTL_MS };
    }
    return table;
  }

  private async loadFromDb(): Promise<CachedTable | null> {
    // Pull the most recent row per (base, quote). Frankfurter publishes one
    // base ("EUR" in our case), so the result is one row per quote currency.
    const rows = await this.prisma.fxRate.findMany({
      orderBy: { asOf: 'desc' },
      take: 200,
    });
    if (rows.length === 0) {
      this.log.warn('no FxRate rows in DB — fx.* responses will be null until worker first run');
      return null;
    }
    const base = rows[0]!.base;
    let asOf = rows[0]!.asOf.toISOString();
    const seen = new Set<string>();
    const rates: Record<string, string> = {};
    for (const r of rows) {
      if (r.base !== base) continue; // ignore stray non-default-base rows
      if (seen.has(r.quote)) continue;
      seen.add(r.quote);
      rates[r.quote] = r.rate.toString();
      if (r.asOf.toISOString() > asOf) asOf = r.asOf.toISOString();
    }
    return { base, rates, asOf };
  }
}
