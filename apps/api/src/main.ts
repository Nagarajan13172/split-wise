import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { PrismaService } from './common/prisma/prisma.service.js';
import { RedisService } from './common/redis/redis.service.js';
import { appRouter } from './trpc/app.router.js';
import { createContext } from './trpc/context.js';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableCors({ origin: [env.WEB_ORIGIN], credentials: true });

  // Mount tRPC on the underlying Express app at /trpc.
  // Express strips the /trpc prefix before passing to the tRPC handler,
  // which then resolves the procedure name from the remaining path.
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(
    '/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext: createContext({
        prisma: app.get(PrismaService),
        redis: app.get(RedisService),
      }),
    }),
  );

  await app.listen(env.API_PORT, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${env.API_PORT}`);
}

void bootstrap();

// Re-export for client typing: `import type { AppRouter } from '@split-wise/api/trpc'`
export type { AppRouter } from './trpc/app.router.js';
