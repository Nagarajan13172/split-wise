import { Inject, Injectable } from '@nestjs/common';
import {
  computeNetBalances,
  computePairwiseBalances,
  simplifyDebts,
  type ExpenseEvent,
  type SettlementEvent,
} from '@split-wise/shared';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { GroupsService } from '../groups/groups.service.js';

const BALANCES_CACHE_PREFIX = 'balances:group:';
const CACHE_TTL_SECONDS = 30;

export interface MemberSummary {
  userId: string;
  displayName: string;
  /** Per-currency net balance, positive means the group owes the user. */
  net: Array<{ currency: string; amount: string }>;
}

export interface PairwiseDTO {
  currency: string;
  fromUserId: string;
  toUserId: string;
  amount: string;
}

export interface BalancesDTO {
  members: MemberSummary[];
  pairwise: PairwiseDTO[];
  simplified: PairwiseDTO[];
  computedAt: string;
}

@Injectable()
export class BalancesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(GroupsService) private readonly groups: GroupsService,
  ) {}

  async forGroup(actorId: string, groupId: string): Promise<BalancesDTO> {
    await this.groups.requireRole(actorId, groupId, ['OWNER', 'ADMIN', 'MEMBER']);

    const cacheKey = `${BALANCES_CACHE_PREFIX}${groupId}`;
    const cached = await this.redis.client.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as BalancesDTO;
      } catch {
        /* fall through to recompute */
      }
    }

    // Pull events + member roster in parallel.
    const [expenses, settlements, members] = await Promise.all([
      this.prisma.expense.findMany({
        where: { groupId, deletedAt: null, status: 'ACTIVE' },
        include: { shares: true },
      }),
      this.prisma.settlement.findMany({
        where: { groupId, deletedAt: null },
      }),
      this.prisma.groupMember.findMany({
        where: { groupId, leftAt: null },
        include: { user: { select: { id: true, displayName: true } } },
      }),
    ]);

    const expenseEvents: ExpenseEvent[] = expenses.map((e) => ({
      paidById: e.paidById,
      amount: e.amount.toFixed(2),
      currency: e.currency,
      shares: e.shares.map((s) => ({ userId: s.userId, amount: s.amount.toFixed(2) })),
    }));
    const settlementEvents: SettlementEvent[] = settlements.map((s) => ({
      fromUserId: s.fromUserId,
      toUserId: s.toUserId,
      amount: s.amount.toFixed(2),
      currency: s.currency,
    }));

    const nets = computeNetBalances(expenseEvents, settlementEvents);
    const pairwise = computePairwiseBalances(expenseEvents, settlementEvents);
    const simplified = simplifyDebts(expenseEvents, settlementEvents);

    // Build per-member per-currency net list
    const memberSummaries: MemberSummary[] = members.map((m) => {
      const balances: Array<{ currency: string; amount: string }> = [];
      for (const [key, amount] of nets.entries()) {
        const [currency, userId] = key.split(':') as [string, string];
        if (userId !== m.userId) continue;
        const rounded = amount.toDecimalPlaces(2);
        if (!rounded.isZero()) balances.push({ currency, amount: rounded.toFixed(2) });
      }
      return { userId: m.userId, displayName: m.user.displayName, net: balances };
    });

    const result: BalancesDTO = {
      members: memberSummaries,
      pairwise: pairwise.map((p) => ({
        currency: p.currency,
        fromUserId: p.fromUserId,
        toUserId: p.toUserId,
        amount: p.amount.toFixed(2),
      })),
      simplified: simplified.map((s) => ({
        currency: s.currency,
        fromUserId: s.fromUserId,
        toUserId: s.toUserId,
        amount: s.amount.toFixed(2),
      })),
      computedAt: new Date().toISOString(),
    };

    await this.redis.client
      .setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result))
      .catch(() => null);

    return result;
  }
}
