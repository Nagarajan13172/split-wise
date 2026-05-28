import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { PrismaService } from './common/prisma/prisma.service.js';
import { RedisService } from './common/redis/redis.service.js';
import { AuthService } from './modules/auth/auth.service.js';
import { TokensService } from './modules/auth/tokens.service.js';
import { UsersService } from './modules/users/users.service.js';
import { GroupsService } from './modules/groups/groups.service.js';
import { InvitesService } from './modules/groups/invites.service.js';
import { ExpensesService } from './modules/expenses/expenses.service.js';
import { SettlementsService } from './modules/expenses/settlements.service.js';
import { BalancesService } from './modules/expenses/balances.service.js';
import { appRouter } from './trpc/app.router.js';
import { createContext } from './trpc/context.js';
import { attachAuthServices } from './trpc/routers/auth.router.js';
import { attachGroupsServices } from './trpc/routers/groups.router.js';
import { attachExpensesServices } from './trpc/routers/expenses.router.js';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const allowedOrigins = env.WEB_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: allowedOrigins, credentials: true });

  // tRPC at /trpc; cookie-parser so the refresh cookie is available to the router.
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(cookieParser());

  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);
  const tokens = app.get(TokensService);
  const users = app.get(UsersService);
  attachAuthServices({
    auth: app.get(AuthService),
    users,
    tokens,
  });
  attachGroupsServices({
    groups: app.get(GroupsService),
    invites: app.get(InvitesService),
    users,
  });
  attachExpensesServices({
    expenses: app.get(ExpensesService),
    settlements: app.get(SettlementsService),
    balances: app.get(BalancesService),
  });

  expressApp.use(
    '/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext: createContext({ prisma, redis, tokens }),
    }),
  );

  await app.listen(env.API_PORT, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${env.API_PORT}`);
}

void bootstrap();

export type { AppRouter } from './trpc/app.router.js';
