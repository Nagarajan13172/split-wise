import { router, publicProcedure } from './trpc.js';

export const appRouter = router({
  /** Smoke test for client wiring. Phase-0 only; will be replaced by domain routers. */
  ping: publicProcedure.query(() => ({ pong: true, at: new Date().toISOString() })),

  health: publicProcedure.query(async ({ ctx }) => {
    const [dbOk, redisOk] = await Promise.all([
      ctx.prisma
        .$queryRaw`SELECT 1`.then(() => true)
        .catch(() => false),
      ctx.redis
        .ping()
        .then(() => true)
        .catch(() => false),
    ]);
    return { ok: dbOk && redisOk, db: dbOk, redis: redisOk };
  }),
});

export type AppRouter = typeof appRouter;
