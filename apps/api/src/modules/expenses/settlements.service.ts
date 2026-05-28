import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { Decimal as PrismaDecimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { GroupsService } from '../groups/groups.service.js';

const BALANCES_CACHE_PREFIX = 'balances:group:';

@Injectable()
export class SettlementsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(GroupsService) private readonly groups: GroupsService,
  ) {}

  async create(input: {
    actorId: string;
    groupId: string;
    fromUserId: string;
    toUserId: string;
    amount: string;
    currency: string;
    occurredAt: string;
    method?: string;
    note?: string;
  }) {
    await this.groups.requireRole(input.actorId, input.groupId, ['OWNER', 'ADMIN', 'MEMBER']);
    // Both parties must be active members
    const members = await this.prisma.groupMember.count({
      where: {
        groupId: input.groupId,
        userId: { in: [input.fromUserId, input.toUserId] },
        leftAt: null,
      },
    });
    if (members !== 2) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'both payer and payee must be active members of the group',
      });
    }
    const settlement = await this.prisma.settlement.create({
      data: {
        groupId: input.groupId,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        amount: new PrismaDecimal(input.amount),
        currency: input.currency,
        occurredAt: new Date(input.occurredAt),
        method: input.method,
        note: input.note,
      },
    });
    await this.invalidateBalances(input.groupId);
    return {
      id: settlement.id,
      amount: settlement.amount.toFixed(2),
      currency: settlement.currency,
      occurredAt: settlement.occurredAt.toISOString(),
    };
  }

  async list(actorId: string, groupId: string) {
    await this.groups.requireRole(actorId, groupId, ['OWNER', 'ADMIN', 'MEMBER']);
    const settlements = await this.prisma.settlement.findMany({
      where: { groupId, deletedAt: null },
      orderBy: { occurredAt: 'desc' },
      include: {
        fromUser: { select: { id: true, displayName: true } },
        toUser: { select: { id: true, displayName: true } },
      },
    });
    return settlements.map((s) => ({
      id: s.id,
      amount: s.amount.toFixed(2),
      currency: s.currency,
      occurredAt: s.occurredAt.toISOString(),
      fromUser: s.fromUser,
      toUser: s.toUser,
      method: s.method,
      note: s.note,
    }));
  }

  async voidSettlement(actorId: string, settlementId: string) {
    const s = await this.prisma.settlement.findFirst({
      where: { id: settlementId, deletedAt: null },
    });
    if (!s) throw new TRPCError({ code: 'NOT_FOUND', message: 'settlement not found' });
    if (!s.groupId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'cross-group settlements not supported' });
    }
    await this.groups.requireRole(actorId, s.groupId, ['OWNER', 'ADMIN', 'MEMBER']);
    await this.prisma.settlement.update({
      where: { id: s.id },
      data: { deletedAt: new Date() },
    });
    await this.invalidateBalances(s.groupId);
  }

  private async invalidateBalances(groupId: string) {
    try {
      await this.redis.client.del(`${BALANCES_CACHE_PREFIX}${groupId}`);
    } catch {
      /* benign */
    }
  }
}
