import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loadEnv } from './config/env.js';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { RedisModule } from './common/redis/redis.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: loadEnv().LOG_LEVEL,
        transport:
          loadEnv().NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
    }),
    PrismaModule,
    RedisModule,
    HealthModule,
  ],
})
export class AppModule {}
