import { z } from 'zod';
import {
  zSignIn,
  zSignUp,
  zPasswordResetRequest,
  zPasswordResetConfirm,
} from '@split-wise/shared';
import { router, publicProcedure, protectedProcedure } from '../trpc.js';
import { REFRESH_COOKIE } from '../context.js';
import { type AuthService } from '../../modules/auth/auth.service.js';
import { type UsersService } from '../../modules/users/users.service.js';
import { type TokensService } from '../../modules/auth/tokens.service.js';
import { loadEnv } from '../../config/env.js';

/** Use a stable module-level instance per service so DI inside Nest is bypassed for
 *  tRPC procedures. We pull instances out of the Nest app in main.ts and attach them
 *  to the router factory below. */
let authService: AuthService;
let usersService: UsersService;
let tokensService: TokensService;

export function attachAuthServices(s: {
  auth: AuthService;
  users: UsersService;
  tokens: TokensService;
}) {
  authService = s.auth;
  usersService = s.users;
  tokensService = s.tokens;
}

function refreshCookieOptions() {
  const env = loadEnv();
  const isProd = env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

/** Pull the refresh token from cookie (web) or body (mobile). */
function pickRefreshToken(ctx: { req: { cookies?: Record<string, string> } }, fromBody?: string) {
  return fromBody ?? ctx.req.cookies?.[REFRESH_COOKIE];
}

export const authRouter = router({
  signup: publicProcedure.input(zSignUp).mutation(async ({ ctx, input }) => {
    const result = await authService.signup({
      ...input,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    ctx.res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
    return result;
  }),

  login: publicProcedure.input(zSignIn).mutation(async ({ ctx, input }) => {
    const result = await authService.login({
      ...input,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    ctx.res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
    return result;
  }),

  googleSignIn: publicProcedure
    .input(z.object({ idToken: z.string().min(10) }))
    .mutation(async ({ ctx, input }) => {
      const result = await authService.googleSignIn({
        idToken: input.idToken,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      ctx.res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
      return result;
    }),

  refresh: publicProcedure
    .input(z.object({ refreshToken: z.string().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const raw = pickRefreshToken(ctx, input?.refreshToken);
      if (!raw) {
        ctx.res.clearCookie(REFRESH_COOKIE);
        throw new Error('missing refresh token');
      }
      const result = await authService.refresh({
        refreshToken: raw,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      ctx.res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
      return result;
    }),

  logout: publicProcedure
    .input(z.object({ refreshToken: z.string().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const raw = pickRefreshToken(ctx, input?.refreshToken);
      if (raw) await authService.logout({ refreshToken: raw });
      ctx.res.clearCookie(REFRESH_COOKIE);
      return { ok: true };
    }),

  verifyEmail: publicProcedure
    .input(z.object({ token: z.string().min(10).max(200) }))
    .mutation(async ({ input }) => {
      await authService.verifyEmail({ token: input.token });
      return { ok: true };
    }),

  resendVerification: protectedProcedure.mutation(async ({ ctx }) => {
    await authService.requestEmailVerification({ userId: ctx.user.id });
    return { ok: true };
  }),

  requestPasswordReset: publicProcedure
    .input(zPasswordResetRequest)
    .mutation(async ({ ctx, input }) => {
      await authService.requestPasswordReset({ email: input.email, ip: ctx.ip });
      return { ok: true };
    }),

  confirmPasswordReset: publicProcedure
    .input(zPasswordResetConfirm)
    .mutation(async ({ input }) => {
      await authService.confirmPasswordReset({
        token: input.token,
        newPassword: input.newPassword,
      });
      return { ok: true };
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await usersService.findById(ctx.user.id);
    if (!user) throw new Error('user not found');
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      homeCurrency: user.homeCurrency,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      avatarKey: user.avatarKey,
    };
  }),
});

/* keep tokensService import alive even if unused at module level */
export const _tokensRef = () => tokensService;
