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

export const zExpenseCreate = z.object({
  groupId: zCuid,
  paidById: zCuid,
  description: z.string().min(1).max(500),
  notes: z.string().max(2000).optional(),
  amount: zPositiveMoney,
  currency: zCurrencyCode,
  occurredAt: zIsoDate,
  categoryKey: z.string().optional(),
  splitType: SplitType,
  shares: z.array(zExpenseShare).optional(),
  items: z.array(zExpenseItem).optional(),
  receiptId: zCuid.optional(),
  idempotencyKey: z.string().max(100).optional(),
});
export type ExpenseCreateDTO = z.infer<typeof zExpenseCreate>;

export const zExpenseUpdate = zExpenseCreate.partial().extend({
  expectedVersion: z.number().int().min(1),
});
export type ExpenseUpdateDTO = z.infer<typeof zExpenseUpdate>;
