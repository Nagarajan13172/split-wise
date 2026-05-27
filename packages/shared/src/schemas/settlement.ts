import { z } from 'zod';
import { zCuid, zPositiveMoney, zCurrencyCode, zIsoDate } from './primitives.js';

export const zSettlementCreate = z
  .object({
    groupId: zCuid.optional(),
    fromUserId: zCuid,
    toUserId: zCuid,
    amount: zPositiveMoney,
    currency: zCurrencyCode,
    occurredAt: zIsoDate,
    method: z.string().max(50).optional(),
    note: z.string().max(500).optional(),
    idempotencyKey: z.string().max(100).optional(),
  })
  .refine((s) => s.fromUserId !== s.toUserId, {
    message: 'fromUserId and toUserId must differ',
    path: ['toUserId'],
  });

export type SettlementCreateDTO = z.infer<typeof zSettlementCreate>;
