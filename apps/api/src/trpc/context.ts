import type { Request, Response } from 'express';
import type { PrismaService } from '../common/prisma/prisma.service.js';
import type { RedisService } from '../common/redis/redis.service.js';

export interface AuthedUser {
  id: string;
  email: string;
}

export interface Context {
  req: Request;
  res: Response;
  prisma: PrismaService;
  redis: RedisService;
  user: AuthedUser | null;
}

export interface ContextDeps {
  prisma: PrismaService;
  redis: RedisService;
}

export const createContext =
  (deps: ContextDeps) =>
  async ({ req, res }: { req: Request; res: Response }): Promise<Context> => {
    // Phase 1 will populate `user` by verifying the Authorization Bearer JWT.
    return { req, res, prisma: deps.prisma, redis: deps.redis, user: null };
  };
