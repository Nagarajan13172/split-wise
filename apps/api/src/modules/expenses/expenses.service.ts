import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma/client';
import { Decimal as PrismaDecimal } from '@prisma/client/runtime/library';
import { splitEqually } from '@split-wise/shared';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { GroupsService } from '../groups/groups.service.js';

const BALANCES_CACHE_PREFIX = 'balances:group:';

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
  splitAmongUserIds: string[];
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
  splitAmongUserIds?: string[];
}

@Injectable()
export class ExpensesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(GroupsService) private readonly groups: GroupsService,
  ) {}

  async create(input: CreateExpenseInput) {
    await this.groups.requireRole(input.actorId, input.groupId, ['OWNER', 'ADMIN', 'MEMBER']);
    await this.assertMembersOfGroup(input.groupId, [input.paidById, ...input.splitAmongUserIds]);

    const categoryId = input.categoryKey
      ? (await this.prisma.category.findUnique({ where: { key: input.categoryKey } }))?.id
      : undefined;

    const shares = splitEqually({
      total: input.amount,
      memberIds: input.splitAmongUserIds,
    });

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
          splitType: 'EQUAL',
          shares: {
            create: shares.map((s) => ({
              userId: s.userId,
              amount: new PrismaDecimal(s.amount),
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
        paidBy: { select: { id: true, displayName: true } },
        createdBy: { select: { id: true, displayName: true } },
        category: { select: { key: true, label: true, icon: true } },
      },
    });
    if (!expense) throw new TRPCError({ code: 'NOT_FOUND', message: 'expense not found' });
    await this.groups.requireRole(actorId, expense.groupId, ['OWNER', 'ADMIN', 'MEMBER']);
    return {
      ...this.toListItemDTO(expense),
      notes: expense.notes,
      createdBy: expense.createdBy,
      shares: expense.shares.map((s) => ({
        userId: s.userId,
        displayName: s.user.displayName,
        amount: s.amount.toFixed(2),
      })),
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
    const newMemberIds = input.splitAmongUserIds ?? existing.shares.map((s) => s.userId);
    await this.assertMembersOfGroup(existing.groupId, [newPaidById, ...newMemberIds]);

    const categoryId =
      input.categoryKey !== undefined
        ? input.categoryKey
          ? (await this.prisma.category.findUnique({ where: { key: input.categoryKey } }))?.id
          : null
        : existing.categoryId;

    const newShares =
      input.splitAmongUserIds || input.amount
        ? splitEqually({ total: newAmount.toFixed(2), memberIds: newMemberIds })
        : null;

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
          version: { increment: 1 },
          ...(newShares && {
            shares: {
              deleteMany: {},
              create: newShares.map((s) => ({
                userId: s.userId,
                amount: new PrismaDecimal(s.amount),
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
      const myShare = e.shares.find((s) => s.userId === userId);
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
      shares: e.shares.map((s) => ({ userId: s.userId, amount: s.amount.toFixed(2) })),
    };
  }
}
