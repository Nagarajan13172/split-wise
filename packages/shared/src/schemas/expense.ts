import { z } from 'zod';
import { zCuid, zPositiveMoney, zNonNegativeMoney, zCurrencyCode, zIsoDate } from './primitives.js';

export const SplitType = z.enum(['EQUAL', 'EXACT', 'PERCENT', 'SHARES', 'ITEMIZED']);
export type SplitType = z.infer<typeof SplitType>;

export const zExpenseShare = z.object({
  id: zCuid.optional(),
  userId: zCuid,
  amount: zNonNegativeMoney,
  /** raw unit used for SHARES/PERCENT splits so the UI can re-render */
  rawUnit: z.string().optional(),
  itemId: zCuid.optional(),
});
export type ExpenseShareDTO = z.infer<typeof zExpenseShare>;

export const zExpenseItem = z.object({
  id: zCuid.optional(),
  label: z.string().min(1).max(200),
  amount: zPositiveMoney,
  quantity: z.number().int().min(1).default(1),
  taxShare: zNonNegativeMoney.optional(),
  tipShare: zNonNegativeMoney.optional(),
  position: z.number().int().min(0).default(0),
  shares: z.array(zExpenseShare).default([]),
});
export type ExpenseItemDTO = z.infer<typeof zExpenseItem>;

/**
 * Phase 3 keeps split types minimal: only EQUAL. Phase 4 will add EXACT / PERCENT /
 * SHARES via a discriminated union. For now, clients send the list of member ids
 * to split among, and the server computes shares deterministically.
 */
export const zExpenseCreate = z.object({
  groupId: zCuid,
  paidById: zCuid,
  description: z.string().min(1).max(500),
  notes: z.string().max(2000).optional(),
  amount: zPositiveMoney,
  currency: zCurrencyCode,
  occurredAt: zIsoDate,
  categoryKey: z.string().optional(),
  splitType: z.literal('EQUAL'),
  splitAmongUserIds: z.array(zCuid).min(1),
  idempotencyKey: z.string().max(100).optional(),
});
export type ExpenseCreateDTO = z.infer<typeof zExpenseCreate>;

export const zExpenseUpdate = z.object({
  expenseId: zCuid,
  expectedVersion: z.number().int().min(1),
  description: z.string().min(1).max(500).optional(),
  notes: z.string().max(2000).optional(),
  amount: zPositiveMoney.optional(),
  currency: zCurrencyCode.optional(),
  occurredAt: zIsoDate.optional(),
  categoryKey: z.string().optional(),
  paidById: zCuid.optional(),
  splitAmongUserIds: z.array(zCuid).min(1).optional(),
});
export type ExpenseUpdateDTO = z.infer<typeof zExpenseUpdate>;
