import { z } from 'zod';
import { zCuid, zCurrencyCode } from './primitives.js';

export const GroupRole = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
export type GroupRole = z.infer<typeof GroupRole>;

export const zGroupCreate = z.object({
  name: z.string().min(1).max(100),
  defaultCurrency: zCurrencyCode,
  simplifyDebts: z.boolean(),
});
export type GroupCreateDTO = z.infer<typeof zGroupCreate>;

export const zGroupUpdate = z.object({
  name: z.string().min(1).max(100).optional(),
  defaultCurrency: zCurrencyCode.optional(),
  simplifyDebts: z.boolean().optional(),
});
export type GroupUpdateDTO = z.infer<typeof zGroupUpdate>;

export const zCreateInvite = z.object({
  groupId: zCuid,
  /** If set, invite is bound to that email (single-use). If omitted, multi-use link. */
  email: z.string().email().optional(),
  expiresInHours: z.number().int().min(1).max(24 * 30).default(24 * 7),
});
export type CreateInviteDTO = z.infer<typeof zCreateInvite>;

export const zAcceptInvite = z.object({
  token: z.string().min(10).max(200),
});
export type AcceptInviteDTO = z.infer<typeof zAcceptInvite>;

export const zRemoveMember = z.object({
  groupId: zCuid,
  userId: zCuid,
});

export const zUpdateMemberRole = z.object({
  groupId: zCuid,
  userId: zCuid,
  role: z.enum(['ADMIN', 'MEMBER']), // can't promote to OWNER
});
