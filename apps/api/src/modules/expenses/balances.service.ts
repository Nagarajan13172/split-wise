import { Inject, Injectable } from '@nestjs/common';
import {
  computeNetBalances,
  computePairwiseBalances,
  simplifyDebts,
  sumInHomeCurrency,
  type ExpenseEvent,
  type SettlementEvent,
} from '@split-wise/shared';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { GroupsService } from '../groups/groups.service.js';
import { FxService } from '../fx/fx.service.js';
import { UsersService } from '../users/users.service.js';

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

export interface HomeCurrencyTotal {
  /** ISO 4217 currency code the caller has chosen as their home currency. */
  homeCurrency: string;
  /** Net balance for the caller, summed across all currencies (positive = owed to them). */
  net: string;
  /** Number of currency-buckets that couldn't be converted (no FX rate). */
  skipped: number;
  /** ISO date of the FxRate snapshot used; null when no rates were available. */
  asOf: string | null;
}

export interface BalancesDTO {
  members: MemberSummary[];
  pairwise: PairwiseDTO[];
  simplified: PairwiseDTO[];
  /** Home-currency rollup for the requesting user. null until FX rates exist. */
  homeTotal: HomeCurrencyTotal | null;
  computedAt: string;
}

@Injectable()
export class BalancesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(GroupsService) private readonly groups: GroupsService,
    @Inject(FxService) private readonly fx: FxService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  async forGroup(actorId: string, groupId: string): Promise<BalancesDTO> {
    await this.groups.requireRole(actorId, groupId, ['OWNER', 'ADMIN', 'MEMBER']);

    // Per-user home currency lives in the User row — the cached payload is
    // shared across the group, so we compute homeTotal _after_ the cached
    // members/pairwise/simplified blob is hydrated.
    const cacheKey = `${BALANCES_CACHE_PREFIX}${groupId}`;
    const cached = await this.redis.client.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        const dto = JSON.parse(cached) as BalancesDTO;
        const homeTotal = await this.computeHomeTotal(actorId, dto.members);
        return { ...dto, homeTotal };
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

    const baseResult: Omit<BalancesDTO, 'homeTotal'> = {
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

    // Cache the per-group, per-user-agnostic blob. homeTotal is per-caller and
    // computed outside the cache below.
    await this.redis.client
      .setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(baseResult))
      .catch(() => null);

    const homeTotal = await this.computeHomeTotal(actorId, baseResult.members);
    return { ...baseResult, homeTotal };
  }

  private async computeHomeTotal(
    actorId: string,
    members: MemberSummary[],
  ): Promise<BalancesDTO['homeTotal']> {
    const me = members.find((m) => m.userId === actorId);
    if (!me) return null;
    const user = await this.users.findById(actorId);
    if (!user) return null;
    const snap = await this.fx.latestSnapshot();
    if (me.net.length === 0) {
      // No balance to convert — still surface the user's home currency so the
      // UI can render "all settled up" with the right label.
      return { homeCurrency: user.homeCurrency, net: '0.00', skipped: 0, asOf: snap?.asOf ?? null };
    }
    const { total, skipped } = sumInHomeCurrency(
      me.net.map((n) => ({ amount: n.amount, currency: n.currency })),
      user.homeCurrency,
      snap?.table ?? null,
    );
    return {
      homeCurrency: user.homeCurrency,
      net: total.toDecimalPlaces(2).toFixed(2),
      skipped,
      asOf: snap?.asOf ?? null,
    };
  }
}
