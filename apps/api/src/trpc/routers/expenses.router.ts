import { z } from 'zod';
import {
  zExpenseCreate,
  zExpenseUpdate,
  zSettlementCreate,
  type ExpenseCreateDTO,
  type ExpenseUpdateDTO,
} from '@split-wise/shared';
import { router, protectedProcedure } from '../trpc.js';
import {
  type ExpensesService,
  type SplitSpec,
} from '../../modules/expenses/expenses.service.js';
import { type SettlementsService } from '../../modules/expenses/settlements.service.js';
import { type BalancesService } from '../../modules/expenses/balances.service.js';

function toSplitSpec(input: ExpenseCreateDTO): SplitSpec {
  switch (input.splitType) {
    case 'EQUAL':
      return { type: 'EQUAL', userIds: input.splitAmongUserIds };
    case 'SHARES':
      return { type: 'SHARES', units: input.shareUnits };
    case 'PERCENT':
      return { type: 'PERCENT', percents: input.percents };
    case 'EXACT':
      return { type: 'EXACT', exactAmounts: input.exactAmounts };
    case 'ITEMIZED':
      return {
        type: 'ITEMIZED',
        items: input.items.map((it) => ({
          label: it.label,
          amount: it.amount,
          quantity: it.quantity,
          assigneeIds: it.assigneeIds,
        })),
        tax: input.tax,
        tip: input.tip,
        tipDistribution: input.tipDistribution,
        receiptScanId: input.receiptScanId,
      };
  }
}

function toUpdateSplitSpec(input: ExpenseUpdateDTO): SplitSpec | undefined {
  if (!('splitType' in input) || input.splitType === undefined) return undefined;
  switch (input.splitType) {
    case 'EQUAL':
      return { type: 'EQUAL', userIds: input.splitAmongUserIds };
    case 'SHARES':
      return { type: 'SHARES', units: input.shareUnits };
    case 'PERCENT':
      return { type: 'PERCENT', percents: input.percents };
    case 'EXACT':
      return { type: 'EXACT', exactAmounts: input.exactAmounts };
  }
}

let expensesService: ExpensesService;
let settlementsService: SettlementsService;
let balancesService: BalancesService;

export function attachExpensesServices(s: {
  expenses: ExpensesService;
  settlements: SettlementsService;
  balances: BalancesService;
}) {
  expensesService = s.expenses;
  settlementsService = s.settlements;
  balancesService = s.balances;
}

export const expensesRouter = router({
  create: protectedProcedure.input(zExpenseCreate).mutation(({ ctx, input }) =>
    expensesService.create({
      actorId: ctx.user.id,
      groupId: input.groupId,
      paidById: input.paidById,
      description: input.description,
      notes: input.notes,
      amount: input.amount,
      currency: input.currency,
      occurredAt: input.occurredAt,
      categoryKey: input.categoryKey,
      split: toSplitSpec(input),
      idempotencyKey: input.idempotencyKey,
    }),
  ),

  list: protectedProcedure
    .input(z.object({ groupId: z.string(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }))
    .query(({ ctx, input }) => expensesService.list(ctx.user.id, input.groupId, input)),

  get: protectedProcedure
    .input(z.object({ expenseId: z.string() }))
    .query(({ ctx, input }) => expensesService.get(ctx.user.id, input.expenseId)),

  update: protectedProcedure.input(zExpenseUpdate).mutation(({ ctx, input }) =>
    expensesService.update({
      actorId: ctx.user.id,
      expenseId: input.expenseId,
      expectedVersion: input.expectedVersion,
      description: input.description,
      notes: input.notes,
      amount: input.amount,
      currency: input.currency,
      occurredAt: input.occurredAt,
      categoryKey: input.categoryKey,
      paidById: input.paidById,
      split: toUpdateSplitSpec(input),
    }),
  ),

  delete: protectedProcedure
    .input(z.object({ expenseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await expensesService.softDelete(ctx.user.id, input.expenseId);
      return { ok: true };
    }),

  audit: protectedProcedure
    .input(z.object({ expenseId: z.string() }))
    .query(({ ctx, input }) => expensesService.audit(ctx.user.id, input.expenseId)),

  /** Cross-group activity feed for the home screen. */
  activity: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(({ ctx, input }) =>
      expensesService.activityForUser(ctx.user.id, input?.limit ?? 30),
    ),

  // ---- Settlements ----

  recordSettlement: protectedProcedure.input(zSettlementCreate).mutation(({ ctx, input }) => {
    if (!input.groupId) {
      throw new Error('groupId is required for group settlements in Phase 3');
    }
    return settlementsService.create({
      actorId: ctx.user.id,
      groupId: input.groupId,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      amount: input.amount,
      currency: input.currency,
      occurredAt: input.occurredAt,
      method: input.method,
      note: input.note,
    });
  }),

  listSettlements: protectedProcedure
    .input(z.object({ groupId: z.string() }))
    .query(({ ctx, input }) => settlementsService.list(ctx.user.id, input.groupId)),

  voidSettlement: protectedProcedure
    .input(z.object({ settlementId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await settlementsService.voidSettlement(ctx.user.id, input.settlementId);
      return { ok: true };
    }),

  // ---- Balances ----

  forGroup: protectedProcedure
    .input(z.object({ groupId: z.string() }))
    .query(({ ctx, input }) => balancesService.forGroup(ctx.user.id, input.groupId)),
});
