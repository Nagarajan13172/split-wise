import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { RedisService } from '../redis/redis.service.js';

export interface RateLimitInput {
  /** namespaced key, e.g. "auth:login:email:foo@bar" */
  key: string;
  /** allowed events in the window */
  limit: number;
  /** window length in seconds */
  windowSeconds: number;
}

/** Simple fixed-window Redis counter. Good enough for auth abuse prevention. */
@Injectable()
export class RateLimitService {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async consume({ key, limit, windowSeconds }: RateLimitInput): Promise<void> {
    const fullKey = `rl:${key}`;
    const count = await this.redis.client.incr(fullKey);
    if (count === 1) {
      await this.redis.client.expire(fullKey, windowSeconds);
    }
    if (count > limit) {
      const ttl = await this.redis.client.ttl(fullKey);
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `Rate limit exceeded. Try again in ${ttl > 0 ? ttl : windowSeconds}s.`,
      });
    }
  }
}
