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
 * Shared base fields across every split-type variant. The discriminator is
 * `splitType`; per-variant shape lives in the variant schemas below.
 */
const expenseBaseShape = {
  groupId: zCuid,
  paidById: zCuid,
  description: z.string().min(1).max(500),
  notes: z.string().max(2000).optional(),
  amount: zPositiveMoney,
  currency: zCurrencyCode,
  occurredAt: zIsoDate,
  categoryKey: z.string().optional(),
  idempotencyKey: z.string().max(100).optional(),
};

const zExpenseEqualPayload = z.object({
  ...expenseBaseShape,
  splitType: z.literal('EQUAL'),
  splitAmongUserIds: z.array(zCuid).min(1),
});

/** SHARES — proportional split. `units` are arbitrary non-negative numbers (e.g. 1, 2, 3). */
const zExpenseSharesPayload = z.object({
  ...expenseBaseShape,
  splitType: z.literal('SHARES'),
  shareUnits: z
    .array(
      z.object({
        userId: zCuid,
        units: z
          .string()
          .regex(/^\d+(\.\d{1,4})?$/, 'must be a non-negative decimal like "2" or "1.5"'),
      }),
    )
    .min(1),
});

/** PERCENT — explicit percentage per member; must sum to exactly 100. */
const zExpensePercentPayload = z.object({
  ...expenseBaseShape,
  splitType: z.literal('PERCENT'),
  percents: z
    .array(
      z.object({
        userId: zCuid,
        percent: z
          .string()
          .regex(/^\d+(\.\d{1,4})?$/, 'must be a non-negative decimal like "33.33"'),
      }),
    )
    .min(1),
});

/** EXACT — explicit money amount per member; must sum to `amount`. */
const zExpenseExactPayload = z.object({
  ...expenseBaseShape,
  splitType: z.literal('EXACT'),
  exactAmounts: z
    .array(
      z.object({
        userId: zCuid,
        amount: zNonNegativeMoney,
      }),
    )
    .min(1),
});

export const zExpenseCreate = z.discriminatedUnion('splitType', [
  zExpenseEqualPayload,
  zExpenseSharesPayload,
  zExpensePercentPayload,
  zExpenseExactPayload,
]);
export type ExpenseCreateDTO = z.infer<typeof zExpenseCreate>;

const updateBaseShape = {
  expenseId: zCuid,
  expectedVersion: z.number().int().min(1),
  description: z.string().min(1).max(500).optional(),
  notes: z.string().max(2000).optional(),
  amount: zPositiveMoney.optional(),
  currency: zCurrencyCode.optional(),
  occurredAt: zIsoDate.optional(),
  categoryKey: z.string().optional(),
  paidById: zCuid.optional(),
};

/**
 * Update is also a discriminated union over `splitType`. Omit `splitType` to
 * leave the split unchanged; specify one to replace the shares entirely.
 */
const zExpenseUpdateEqual = z.object({
  ...updateBaseShape,
  splitType: z.literal('EQUAL'),
  splitAmongUserIds: z.array(zCuid).min(1),
});

const zExpenseUpdateShares = z.object({
  ...updateBaseShape,
  splitType: z.literal('SHARES'),
  shareUnits: z
    .array(
      z.object({
        userId: zCuid,
        units: z.string().regex(/^\d+(\.\d{1,4})?$/, 'must be a non-negative decimal'),
      }),
    )
    .min(1),
});

const zExpenseUpdatePercent = z.object({
  ...updateBaseShape,
  splitType: z.literal('PERCENT'),
  percents: z
    .array(
      z.object({
        userId: zCuid,
        percent: z.string().regex(/^\d+(\.\d{1,4})?$/, 'must be a non-negative decimal'),
      }),
    )
    .min(1),
});

const zExpenseUpdateExact = z.object({
  ...updateBaseShape,
  splitType: z.literal('EXACT'),
  exactAmounts: z
    .array(z.object({ userId: zCuid, amount: zNonNegativeMoney }))
    .min(1),
});

const zExpenseUpdateNoChange = z.object(updateBaseShape);

export const zExpenseUpdate = z.union([
  zExpenseUpdateNoChange,
  zExpenseUpdateEqual,
  zExpenseUpdateShares,
  zExpenseUpdatePercent,
  zExpenseUpdateExact,
]);
export type ExpenseUpdateDTO = z.infer<typeof zExpenseUpdate>;
