import { z } from 'zod';
import { zCurrencyCode } from './primitives.js';

export const zSignUp = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(128),
  displayName: z.string().min(1).max(80),
  homeCurrency: zCurrencyCode.default('USD'),
});
export type SignUpDTO = z.infer<typeof zSignUp>;

export const zSignIn = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});
export type SignInDTO = z.infer<typeof zSignIn>;

export const zPasswordResetRequest = z.object({
  email: z.string().email().max(254),
});

export const zPasswordResetConfirm = z.object({
  token: z.string().min(10).max(200),
  newPassword: z.string().min(10).max(128),
});

export const zTokens = z.object({
  accessToken: z.string(),
  /** refresh token only returned to mobile; web gets it as HttpOnly cookie */
  refreshToken: z.string().optional(),
  accessTokenExpiresAt: z.string(),
});
export type TokensDTO = z.infer<typeof zTokens>;
