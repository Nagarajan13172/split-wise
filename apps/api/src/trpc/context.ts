import type { Request, Response } from 'express';
import type { PrismaService } from '../common/prisma/prisma.service.js';
import type { RedisService } from '../common/redis/redis.service.js';
import type { TokensService } from '../modules/auth/tokens.service.js';

export interface AuthedUser {
  id: string;
  sessionId: string;
}

export interface Context {
  req: Request;
  res: Response;
  prisma: PrismaService;
  redis: RedisService;
  user: AuthedUser | null;
  ip?: string;
  userAgent?: string;
}

export interface ContextDeps {
  prisma: PrismaService;
  redis: RedisService;
  tokens: TokensService;
}

const REFRESH_COOKIE = 'splitwise_refresh';
export { REFRESH_COOKIE };

export const createContext =
  (deps: ContextDeps) =>
  async ({ req, res }: { req: Request; res: Response }): Promise<Context> => {
    const auth = req.header('authorization') ?? req.header('Authorization');
    let user: AuthedUser | null = null;
    if (auth?.startsWith('Bearer ')) {
      try {
        const claims = deps.tokens.verifyAccessToken(auth.slice('Bearer '.length).trim());
        user = { id: claims.sub, sessionId: claims.sid };
      } catch {
        // invalid/expired access token → leave user null; client will refresh
      }
    }
    const xff = req.header('x-forwarded-for');
    const ip = (xff?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? undefined) || undefined;
    const userAgent = req.header('user-agent') ?? undefined;
    return { req, res, prisma: deps.prisma, redis: deps.redis, user, ip, userAgent };
  };
