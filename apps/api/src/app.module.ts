import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loadEnv } from './config/env.js';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { RedisModule } from './common/redis/redis.module.js';
import { EmailModule } from './common/email/email.module.js';
import { RateLimitModule } from './common/rate-limit/rate-limit.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { GroupsModule } from './modules/groups/groups.module.js';
import { ReceiptsModule } from './modules/receipts/receipts.module.js';
import { FxModule } from './modules/fx/fx.module.js';
import { ExpensesModule } from './modules/expenses/expenses.module.js';

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
    EmailModule,
    RateLimitModule,
    HealthModule,
    UsersModule,
    AuthModule,
    GroupsModule,
    ReceiptsModule,
    FxModule,
    ExpensesModule,
  ],
})
export class AppModule {}
