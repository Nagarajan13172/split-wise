import { z } from 'zod';
import { zCuid, zCurrencyCode } from './primitives.js';

export const GroupRole = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
export type GroupRole = z.infer<typeof GroupRole>;

export const zGroupCreate = z.object({
  name: z.string().min(1).max(100),
  defaultCurrency: zCurrencyCode.default('USD'),
  simplifyDebts: z.boolean().default(true),
});
export type GroupCreateDTO = z.infer<typeof zGroupCreate>;

export const zGroupUpdate = zGroupCreate.partial();

export const zMemberInvite = z.object({
  groupId: zCuid,
  email: z.string().email().optional(),
  expiresInHours: z.number().int().min(1).max(24 * 30).default(24 * 7),
});
export type MemberInviteDTO = z.infer<typeof zMemberInvite>;
