import { z } from 'zod';
import { zCuid, zPositiveMoney, zNonNegativeMoney, zCurrencyCode } from './primitives.js';

/**
 * Output of the OCR pipeline (worker → API → client). Mirrors what the parser
 * extracts from raw OCR text. Items[] is always present (possibly empty); the
 * rest is best-effort.
 */
export const zReceiptOcrItem = z.object({
  label: z.string().min(1).max(200),
  amount: zPositiveMoney,
  quantity: z.number().int().min(1).default(1),
});
export type ReceiptOcrItem = z.infer<typeof zReceiptOcrItem>;

export const zReceiptOcrResult = z.object({
  merchant: z.string().max(200).optional(),
  items: z.array(zReceiptOcrItem),
  subtotal: zNonNegativeMoney.optional(),
  tax: zNonNegativeMoney.optional(),
  tip: zNonNegativeMoney.optional(),
  total: zNonNegativeMoney,
  currency: zCurrencyCode.optional(),
  /** Free-form notes from the parser to surface in the editor (e.g. low-confidence). */
  warnings: z.array(z.string()).default([]),
});
export type ReceiptOcrResult = z.infer<typeof zReceiptOcrResult>;

export const ReceiptStatus = z.enum([
  'UPLOADED',
  'PROCESSING',
  'PARSED',
  'FAILED',
  'CONFIRMED',
]);
export type ReceiptStatus = z.infer<typeof ReceiptStatus>;

/** Item with explicit per-member assignment for the itemized split. */
export const zItemizedItemInput = z.object({
  label: z.string().min(1).max(200),
  amount: zPositiveMoney,
  quantity: z.number().int().min(1).default(1),
  /** Members the item should be split equally among. Must be non-empty. */
  assigneeIds: z.array(zCuid).min(1),
});
export type ItemizedItemInput = z.infer<typeof zItemizedItemInput>;

export const zItemizedExpensePayload = z.object({
  items: z.array(zItemizedItemInput).min(1),
  /** Pre-tax / pre-tip total of items. If omitted, computed by the server. */
  subtotal: zNonNegativeMoney.optional(),
  tax: zNonNegativeMoney.optional(),
  tip: zNonNegativeMoney.optional(),
  /** How to distribute the tip across members.
   *  - 'PRO_RATA': proportional to each member's item subtotal (Splitwise default)
   *  - 'EQUAL': split tip equally across all members who have any item assigned
   */
  tipDistribution: z.enum(['PRO_RATA', 'EQUAL']).default('PRO_RATA'),
  /** Optional link back to the ReceiptScan that produced these items. */
  receiptScanId: zCuid.optional(),
});
export type ItemizedExpensePayload = z.infer<typeof zItemizedExpensePayload>;
