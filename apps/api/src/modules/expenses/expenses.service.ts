import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma/client';
import { Decimal as PrismaDecimal } from '@prisma/client/runtime/library';
import {
  splitEqually,
  splitByShares,
  splitByPercentage,
  splitByExactAmounts,
  computeItemizedSplit,
  type ShareOutput,
} from '@split-wise/shared';
import { ReceiptsService } from '../receipts/receipts.service.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { GroupsService } from '../groups/groups.service.js';

const BALANCES_CACHE_PREFIX = 'balances:group:';

export interface ItemizedItemSpec {
  label: string;
  amount: string;
  quantity?: number;
  assigneeIds: string[];
}

export type SplitSpec =
  | { type: 'EQUAL'; userIds: string[] }
  | { type: 'SHARES'; units: Array<{ userId: string; units: string }> }
  | { type: 'PERCENT'; percents: Array<{ userId: string; percent: string }> }
  | { type: 'EXACT'; exactAmounts: Array<{ userId: string; amount: string }> }
  | {
      type: 'ITEMIZED';
      items: ItemizedItemSpec[];
      tax?: string;
      tip?: string;
      tipDistribution: 'PRO_RATA' | 'EQUAL';
      receiptScanId?: string;
    };

export interface CreateExpenseInput {
  actorId: string;
  groupId: string;
  paidById: string;
  description: string;
  notes?: string;
  amount: string;
  currency: string;
  occurredAt: string;
  categoryKey?: string;
  split: SplitSpec;
  idempotencyKey?: string;
}

export interface UpdateExpenseInput {
  actorId: string;
  expenseId: string;
  expectedVersion: number;
  description?: string;
  notes?: string;
  amount?: string;
  currency?: string;
  occurredAt?: string;
  categoryKey?: string;
  paidById?: string;
  /** Omit to leave split unchanged. */
  split?: SplitSpec;
}

function participantIdsOf(split: SplitSpec): string[] {
  switch (split.type) {
    case 'EQUAL':
      return split.userIds;
    case 'SHARES':
      return split.units.map((s) => s.userId);
    case 'PERCENT':
      return split.percents.map((p) => p.userId);
    case 'EXACT':
      return split.exactAmounts.map((a) => a.userId);
    case 'ITEMIZED': {
      const set = new Set<string>();
      for (const item of split.items) for (const id of item.assigneeIds) set.add(id);
      return [...set];
    }
  }
}

function computeSharesForSplit(amount: string, split: SplitSpec): ShareOutput[] {
  switch (split.type) {
    case 'EQUAL':
      return splitEqually({ total: amount, memberIds: split.userIds });
    case 'SHARES':
      return splitByShares({
        total: amount,
        sharesByMember: split.units.map((u) => ({ userId: u.userId, shares: u.units })),
      });
    case 'PERCENT':
      return splitByPercentage({
        total: amount,
        percentsByMember: split.percents.map((p) => ({ userId: p.userId, percent: p.percent })),
      });
    case 'EXACT':
      return splitByExactAmounts({
        total: amount,
        amountsByMember: split.exactAmounts.map((a) => ({ userId: a.userId, amount: a.amount })),
      });
    case 'ITEMIZED': {
      // ITEMIZED uses its own computer that also returns per-item shares.
      // For the parent-expense `shares` list, we return only the aggregated
      // per-user totals — items themselves persist via the items relation.
      const result = computeItemizedSplit({
        items: split.items.map((it) => ({
          label: it.label,
          amount: it.amount,
          assigneeIds: it.assigneeIds,
        })),
        tax: split.tax,
        tip: split.tip,
        tipDistribution: split.tipDistribution,
      });
      return result.perUser.map((u) => ({ userId: u.userId, amount: u.amount }));
    }
  }
}

@Injectable()
export class ExpensesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(GroupsService) private readonly groups: GroupsService,
    @Inject(ReceiptsService) private readonly receipts: ReceiptsService,
  ) {}

  async create(input: CreateExpenseInput) {
    await this.groups.requireRole(input.actorId, input.groupId, ['OWNER', 'ADMIN', 'MEMBER']);
    const participants = participantIdsOf(input.split);
    await this.assertMembersOfGroup(input.groupId, [input.paidById, ...participants]);

    const categoryId = input.categoryKey
      ? (await this.prisma.category.findUnique({ where: { key: input.categoryKey } }))?.id
      : undefined;

    // For ITEMIZED, we persist per-item shares (with itemId) PLUS per-user
    // tax+tip shares (without itemId). Sum across all rows = expense.amount.
    if (input.split.type === 'ITEMIZED') {
      const expense = await this.createItemized(input, input.split, categoryId);
      if (input.split.receiptScanId) {
        await this.receipts
          .markConfirmed(input.actorId, input.split.receiptScanId)
          .catch(() => null);
      }
      await this.invalidateBalances(input.groupId);
      return this.toDTO(expense);
    }

    let shares: ShareOutput[];
    try {
      shares = computeSharesForSplit(input.amount, input.split);
    } catch (err) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: err instanceof Error ? err.message : 'invalid split',
      });
    }

    const expense = await this.prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          groupId: input.groupId,
          paidById: input.paidById,
          createdById: input.actorId,
          categoryId,
          description: input.description,
          notes: input.notes,
          currency: input.currency,
          amount: new PrismaDecimal(input.amount),
          occurredAt: new Date(input.occurredAt),
          splitType: input.split.type,
          shares: {
            create: shares.map((s) => ({
              userId: s.userId,
              amount: new PrismaDecimal(s.amount),
              rawUnit: s.rawUnit ? new PrismaDecimal(s.rawUnit) : null,
            })),
          },
        },
        include: { shares: true },
      });
      await this.writeAudit(tx, created.id, input.actorId, 'CREATE', null, this.serialize(created));
      return created;
    });

    await this.invalidateBalances(input.groupId);
    return this.toDTO(expense);
  }

  private async createItemized(
    input: CreateExpenseInput,
    split: Extract<SplitSpec, { type: 'ITEMIZED' }>,
    categoryId: string | undefined,
  ) {
    // Compute per-item-per-user shares + per-user tax+tip shares.
    const result = computeItemizedSplit({
      items: split.items.map((it) => ({
        label: it.label,
        amount: it.amount,
        assigneeIds: it.assigneeIds,
      })),
      tax: split.tax,
      tip: split.tip,
      tipDistribution: split.tipDistribution,
    });

    // Sanity check: requested amount should match computed total (within 1 cent).
    const requested = new PrismaDecimal(input.amount);
    const computed = new PrismaDecimal(result.total);
    if (requested.minus(computed).abs().greaterThan(new PrismaDecimal('0.01'))) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `itemized total ${result.total} does not match requested amount ${input.amount}`,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          groupId: input.groupId,
          paidById: input.paidById,
          createdById: input.actorId,
          categoryId,
          description: input.description,
          notes: input.notes,
          currency: input.currency,
          amount: new PrismaDecimal(result.total),
          occurredAt: new Date(input.occurredAt),
          splitType: 'ITEMIZED',
          receiptId: split.receiptScanId,
        },
      });

      // Create items + per-item shares
      for (let i = 0; i < split.items.length; i++) {
        const item = split.items[i]!;
        const perItem = result.perItem[i]!;
        const createdItem = await tx.expenseItem.create({
          data: {
            expenseId: created.id,
            label: item.label,
            amount: new PrismaDecimal(item.amount),
            quantity: item.quantity ?? 1,
            position: i,
          },
        });
        for (const share of perItem.shares) {
          await tx.expenseShare.create({
            data: {
              expenseId: created.id,
              userId: share.userId,
              itemId: createdItem.id,
              amount: new PrismaDecimal(share.amount),
            },
          });
        }
      }

      // Create per-user tax+tip shares (itemId null) — these complete the balance math.
      for (const tt of result.perUserTaxTip) {
        if (new PrismaDecimal(tt.amount).isZero()) continue;
        await tx.expenseShare.create({
          data: {
            expenseId: created.id,
            userId: tt.userId,
            amount: new PrismaDecimal(tt.amount),
          },
        });
      }

      await this.writeAudit(tx, created.id, input.actorId, 'CREATE', null, {
        ...this.serialize(created),
        itemized: { subtotal: result.subtotal, tax: split.tax, tip: split.tip },
      });

      return tx.expense.findUniqueOrThrow({
        where: { id: created.id },
        include: { shares: true },
      });
    });
  }

  async list(actorId: string, groupId: string, opts: { limit?: number; cursor?: string } = {}) {
    await this.groups.requireRole(actorId, groupId, ['OWNER', 'ADMIN', 'MEMBER']);
    const limit = Math.min(opts.limit ?? 30, 100);
    const expenses = await this.prisma.expense.findMany({
      where: { groupId, deletedAt: null },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor && { cursor: { id: opts.cursor }, skip: 1 }),
      include: {
        shares: true,
        paidBy: { select: { id: true, displayName: true } },
        category: { select: { key: true, label: true, icon: true } },
      },
    });
    let nextCursor: string | undefined;
    if (expenses.length > limit) {
      nextCursor = expenses.pop()!.id;
    }
    return {
      items: expenses.map((e) => this.toListItemDTO(e)),
      nextCursor,
    };
  }

  async get(actorId: string, expenseId: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, deletedAt: null },
      include: {
        shares: { include: { user: { select: { id: true, displayName: true } } } },
        items: { orderBy: { position: 'asc' } },
        paidBy: { select: { id: true, displayName: true } },
        createdBy: { select: { id: true, displayName: true } },
        category: { select: { key: true, label: true, icon: true } },
      },
    });
    if (!expense) throw new TRPCError({ code: 'NOT_FOUND', message: 'expense not found' });
    await this.groups.requireRole(actorId, expense.groupId, ['OWNER', 'ADMIN', 'MEMBER']);

    // Build aggregated per-user shares (with displayName) for the client.
    const displayByUser = new Map<string, string>();
    for (const s of expense.shares) displayByUser.set(s.userId, s.user.displayName);
    const aggregated = aggregateSharesByUser(expense.shares).map((s) => ({
      userId: s.userId,
      displayName: displayByUser.get(s.userId) ?? 'Member',
      amount: s.amount,
      rawUnit: expense.shares.find((row) => row.userId === s.userId)?.rawUnit?.toString() ?? null,
    }));

    // For ITEMIZED, expose items + per-item assignees so the editor can re-render.
    const itemsDTO = expense.items.map((item) => ({
      id: item.id,
      label: item.label,
      amount: item.amount.toFixed(2),
      quantity: item.quantity,
      position: item.position,
      assigneeIds: expense.shares
        .filter((s) => s.itemId === item.id)
        .map((s) => s.userId),
    }));

    return {
      ...this.toListItemDTO(expense),
      notes: expense.notes,
      createdBy: expense.createdBy,
      splitType: expense.splitType,
      shares: aggregated,
      items: itemsDTO,
      receiptScanId: expense.receiptId ?? null,
      version: expense.version,
    };
  }

  async update(input: UpdateExpenseInput) {
    const existing = await this.prisma.expense.findFirst({
      where: { id: input.expenseId, deletedAt: null },
      include: { shares: true },
    });
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'expense not found' });
    await this.groups.requireRole(input.actorId, existing.groupId, ['OWNER', 'ADMIN', 'MEMBER']);
    if (existing.version !== input.expectedVersion) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `expense was modified by someone else (expected v${input.expectedVersion}, current v${existing.version})`,
      });
    }
    const newPaidById = input.paidById ?? existing.paidById;
    const newAmount = input.amount ? new PrismaDecimal(input.amount) : existing.amount;
    const newCurrency = input.currency ?? existing.currency;
    const participants = input.split
      ? participantIdsOf(input.split)
      : existing.shares.map((s) => s.userId);
    await this.assertMembersOfGroup(existing.groupId, [newPaidById, ...participants]);

    const categoryId =
      input.categoryKey !== undefined
        ? input.categoryKey
          ? (await this.prisma.category.findUnique({ where: { key: input.categoryKey } }))?.id
          : null
        : existing.categoryId;

    // Recompute shares if (a) caller explicitly changed split OR (b) only the
    // amount changed, in which case we re-split on the same member set with
    // EQUAL (legacy behaviour preserved when no explicit split provided).
    let newShares: ShareOutput[] | null = null;
    let newSplitType = existing.splitType;
    if (input.split) {
      try {
        newShares = computeSharesForSplit(newAmount.toFixed(2), input.split);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'invalid split',
        });
      }
      newSplitType = input.split.type;
    } else if (input.amount) {
      // Amount changed but split type unchanged — only safe to re-split for EQUAL.
      // For SHARES/PERCENT/EXACT, the client must resend the split payload.
      if (existing.splitType !== 'EQUAL') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `changing amount on a ${existing.splitType} split requires resending the split payload`,
        });
      }
      newShares = splitEqually({
        total: newAmount.toFixed(2),
        memberIds: existing.shares.map((s) => s.userId),
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.expense.update({
        where: { id: existing.id },
        data: {
          description: input.description ?? existing.description,
          notes: input.notes !== undefined ? input.notes : existing.notes,
          amount: newAmount,
          currency: newCurrency,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : existing.occurredAt,
          categoryId,
          paidById: newPaidById,
          splitType: newSplitType,
          version: { increment: 1 },
          ...(newShares && {
            shares: {
              deleteMany: {},
              create: newShares.map((s) => ({
                userId: s.userId,
                amount: new PrismaDecimal(s.amount),
                rawUnit: s.rawUnit ? new PrismaDecimal(s.rawUnit) : null,
              })),
            },
          }),
        },
        include: { shares: true },
      });
      await this.writeAudit(
        tx,
        result.id,
        input.actorId,
        'UPDATE',
        this.serialize(existing),
        this.serialize(result),
      );
      return result;
    });

    await this.invalidateBalances(existing.groupId);
    return this.toDTO(updated);
  }

  async softDelete(actorId: string, expenseId: string) {
    const existing = await this.prisma.expense.findFirst({
      where: { id: expenseId, deletedAt: null },
      include: { shares: true },
    });
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'expense not found' });
    await this.groups.requireRole(actorId, existing.groupId, ['OWNER', 'ADMIN', 'MEMBER']);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.expense.update({
        where: { id: existing.id },
        data: { deletedAt: new Date(), status: 'DELETED' },
      });
      await this.writeAudit(tx, existing.id, actorId, 'DELETE', this.serialize(existing), this.serialize(updated));
    });
    await this.invalidateBalances(existing.groupId);
  }

  /**
   * Recent expenses + settlements across every group the user belongs to.
   * Powers the home-screen activity feed.
   */
  async activityForUser(userId: string, limit = 30) {
    const memberships = await this.prisma.groupMember.findMany({
      where: { userId, leftAt: null, group: { deletedAt: null } },
      select: { groupId: true },
    });
    const groupIds = memberships.map((m) => m.groupId);
    if (groupIds.length === 0) return { items: [] };

    const [expenses, settlements] = await Promise.all([
      this.prisma.expense.findMany({
        where: { groupId: { in: groupIds }, deletedAt: null },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: limit,
        include: {
          shares: { select: { userId: true, amount: true } },
          paidBy: { select: { id: true, displayName: true } },
          group: { select: { id: true, name: true } },
          category: { select: { key: true, label: true, icon: true } },
        },
      }),
      this.prisma.settlement.findMany({
        where: { groupId: { in: groupIds }, deletedAt: null },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: limit,
        include: {
          fromUser: { select: { id: true, displayName: true } },
          toUser: { select: { id: true, displayName: true } },
          group: { select: { id: true, name: true } },
        },
      }),
    ]);

    const items: Array<{
      kind: 'expense' | 'settlement';
      id: string;
      occurredAt: string;
      amount: string;
      currency: string;
      group: { id: string; name: string };
      title: string;
      subtitle: string;
      icon?: string;
    }> = [];

    for (const e of expenses) {
      // Sum all my-shares (ITEMIZED splits store multiple rows per user).
      const mySharesTotal = e.shares
        .filter((s) => s.userId === userId)
        .reduce((acc, s) => acc.plus(s.amount), new PrismaDecimal(0));
      const myShare = mySharesTotal.isZero() ? undefined : { amount: mySharesTotal };
      const youPaid = e.paidById === userId;
      let subtitle: string;
      if (youPaid && myShare) {
        const owed = e.amount.minus(myShare.amount);
        subtitle = owed.isZero()
          ? 'You paid (only you in split)'
          : `You paid · others owe ${owed.toFixed(2)}`;
      } else if (myShare) {
        subtitle = `${e.paidBy.displayName} paid · you owe ${myShare.amount.toFixed(2)}`;
      } else {
        subtitle = `${e.paidBy.displayName} paid`;
      }
      items.push({
        kind: 'expense',
        id: e.id,
        occurredAt: e.occurredAt.toISOString(),
        amount: e.amount.toFixed(2),
        currency: e.currency,
        group: e.group!,
        title: e.description,
        subtitle,
        icon: e.category?.icon ?? undefined,
      });
    }

    for (const s of settlements) {
      const youPaid = s.fromUserId === userId;
      const youReceived = s.toUserId === userId;
      const subtitle = youPaid
        ? `You paid ${s.toUser.displayName}`
        : youReceived
          ? `${s.fromUser.displayName} paid you`
          : `${s.fromUser.displayName} paid ${s.toUser.displayName}`;
      items.push({
        kind: 'settlement',
        id: s.id,
        occurredAt: s.occurredAt.toISOString(),
        amount: s.amount.toFixed(2),
        currency: s.currency,
        group: s.group!,
        title: 'Settlement',
        subtitle,
      });
    }

    items.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
    return { items: items.slice(0, limit) };
  }

  async audit(actorId: string, expenseId: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId },
      select: { groupId: true },
    });
    if (!expense) throw new TRPCError({ code: 'NOT_FOUND', message: 'expense not found' });
    await this.groups.requireRole(actorId, expense.groupId, ['OWNER', 'ADMIN', 'MEMBER']);
    const entries = await this.prisma.expenseAudit.findMany({
      where: { expenseId },
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { id: true, displayName: true } } },
    });
    return entries.map((e) => ({
      id: e.id,
      action: e.action,
      actor: e.actor,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  // ------------ helpers ------------

  private async assertMembersOfGroup(groupId: string, userIds: string[]) {
    const unique = [...new Set(userIds)];
    const count = await this.prisma.groupMember.count({
      where: { groupId, userId: { in: unique }, leftAt: null },
    });
    if (count !== unique.length) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'all participants must be active members of the group',
      });
    }
  }

  private async invalidateBalances(groupId: string) {
    try {
      await this.redis.client.del(`${BALANCES_CACHE_PREFIX}${groupId}`);
    } catch {
      /* cache miss is benign */
    }
  }

  private serialize(e: { id: string; amount: PrismaDecimal | string; [k: string]: unknown }) {
    return JSON.parse(
      JSON.stringify(e, (_k, v) => {
        if (v instanceof Date) return v.toISOString();
        if (typeof v === 'object' && v !== null && 'toFixed' in v) {
          return (v as PrismaDecimal).toFixed(2);
        }
        return v;
      }),
    );
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    expenseId: string,
    actorId: string,
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE',
    before: unknown,
    after: unknown,
  ) {
    await tx.expenseAudit.create({
      data: {
        expenseId,
        actorId,
        action,
        before: before === null ? undefined : (before as Prisma.InputJsonValue),
        after: after === null ? undefined : (after as Prisma.InputJsonValue),
      },
    });
  }

  private toDTO(e: { id: string; amount: PrismaDecimal; currency: string; description: string; version: number; occurredAt: Date }) {
    return {
      id: e.id,
      amount: e.amount.toFixed(2),
      currency: e.currency,
      description: e.description,
      version: e.version,
      occurredAt: e.occurredAt.toISOString(),
    };
  }

  private toListItemDTO(e: {
    id: string;
    amount: PrismaDecimal;
    currency: string;
    description: string;
    occurredAt: Date;
    paidBy: { id: string; displayName: string };
    category: { key: string; label: string; icon: string } | null;
    shares: { userId: string; amount: PrismaDecimal }[];
  }) {
    return {
      id: e.id,
      amount: e.amount.toFixed(2),
      currency: e.currency,
      description: e.description,
      occurredAt: e.occurredAt.toISOString(),
      paidBy: e.paidBy,
      category: e.category,
      shares: aggregateSharesByUser(e.shares),
    };
  }
}

/**
 * For ITEMIZED expenses we persist multiple ExpenseShare rows per user (one
 * per item + one for tax+tip). Clients want a single per-user total — sum
 * across rows so the consumer-facing shape stays consistent.
 */
function aggregateSharesByUser(
  shares: ReadonlyArray<{ userId: string; amount: PrismaDecimal }>,
): Array<{ userId: string; amount: string }> {
  const totals = new Map<string, PrismaDecimal>();
  for (const s of shares) {
    totals.set(s.userId, (totals.get(s.userId) ?? new PrismaDecimal(0)).plus(s.amount));
  }
  return [...totals.entries()].map(([userId, amount]) => ({
    userId,
    amount: amount.toFixed(2),
  }));
}
