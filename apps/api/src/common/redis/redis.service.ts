import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { loadEnv } from '../../config/env.js';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    this.client = new Redis(loadEnv().REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
