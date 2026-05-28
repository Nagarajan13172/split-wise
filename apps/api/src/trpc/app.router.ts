import { router, publicProcedure } from './trpc.js';
import { authRouter } from './routers/auth.router.js';
import { groupsRouter } from './routers/groups.router.js';
import { expensesRouter } from './routers/expenses.router.js';
import { receiptsRouter } from './routers/receipts.router.js';

export const appRouter = router({
  /** Smoke test for client wiring. */
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

  auth: authRouter,
  groups: groupsRouter,
  expenses: expensesRouter,
  receipts: receiptsRouter,
});

export type AppRouter = typeof appRouter;
