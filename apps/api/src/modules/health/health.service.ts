import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RedisService } from '../../common/redis/redis.service.js';

export interface HealthResult {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  checks: {
    database: { ok: boolean; latencyMs?: number; error?: string };
    redis: { ok: boolean; latencyMs?: number; error?: string };
  };
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthResult> {
    const [db, rd] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    const ok = db.ok && rd.ok;
    return {
      status: ok ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database: db, redis: rd },
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase() {
    const start = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async checkRedis() {
    const start = Date.now();
    try {
      await this.redis.ping();
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
