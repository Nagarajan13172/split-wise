import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class GroupsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: { actorId: string; name: string; defaultCurrency: string; simplifyDebts: boolean }) {
    return this.prisma.$transaction(async (tx) => {
      const group = await tx.group.create({
        data: {
          name: input.name,
          defaultCurrency: input.defaultCurrency,
          simplifyDebts: input.simplifyDebts,
          createdById: input.actorId,
        },
      });
      await tx.groupMember.create({
        data: { groupId: group.id, userId: input.actorId, role: 'OWNER' },
      });
      return group;
    });
  }

  /** Groups the user is currently a member of (excluding soft-deleted and ones they left). */
  listForUser(userId: string) {
    return this.prisma.group.findMany({
      where: {
        deletedAt: null,
        members: { some: { userId, leftAt: null } },
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        members: {
          where: { leftAt: null },
          select: {
            role: true,
            joinedAt: true,
            user: { select: { id: true, displayName: true, email: true, avatarKey: true } },
          },
        },
      },
    });
  }

  async getDetail(actorId: string, groupId: string) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deletedAt: null },
      include: {
        members: {
          where: { leftAt: null },
          orderBy: { joinedAt: 'asc' },
          select: {
            role: true,
            joinedAt: true,
            user: { select: { id: true, displayName: true, email: true, avatarKey: true } },
          },
        },
      },
    });
    if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: 'group not found' });
    const me = group.members.find((m) => m.user.id === actorId);
    if (!me) throw new TRPCError({ code: 'FORBIDDEN', message: 'not a member of this group' });
    return { ...group, myRole: me.role };
  }

  async update(input: {
    actorId: string;
    groupId: string;
    name?: string;
    defaultCurrency?: string;
    simplifyDebts?: boolean;
  }) {
    await this.requireRole(input.actorId, input.groupId, ['OWNER', 'ADMIN']);
    return this.prisma.group.update({
      where: { id: input.groupId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.defaultCurrency !== undefined && { defaultCurrency: input.defaultCurrency }),
        ...(input.simplifyDebts !== undefined && { simplifyDebts: input.simplifyDebts }),
      },
    });
  }

  async softDelete(actorId: string, groupId: string) {
    await this.requireRole(actorId, groupId, ['OWNER']);
    await this.prisma.group.update({
      where: { id: groupId },
      data: { deletedAt: new Date() },
    });
  }

  async leave(actorId: string, groupId: string) {
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: actorId } },
    });
    if (!membership || membership.leftAt) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'not a member of this group' });
    }
    if (membership.role === 'OWNER') {
      // For v1: forbid owner from leaving. Owner must delete the group or transfer ownership later.
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Owner cannot leave. Transfer ownership or delete the group instead.',
      });
    }
    await this.prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: actorId } },
      data: { leftAt: new Date() },
    });
  }

  async removeMember(input: { actorId: string; groupId: string; userId: string }) {
    await this.requireRole(input.actorId, input.groupId, ['OWNER', 'ADMIN']);
    if (input.actorId === input.userId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Use leave to remove yourself.',
      });
    }
    const target = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: input.groupId, userId: input.userId } },
    });
    if (!target || target.leftAt) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'member not in this group' });
    }
    if (target.role === 'OWNER') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'cannot remove the owner' });
    }
    await this.prisma.groupMember.update({
      where: { groupId_userId: { groupId: input.groupId, userId: input.userId } },
      data: { leftAt: new Date() },
    });
  }

  async updateMemberRole(input: {
    actorId: string;
    groupId: string;
    userId: string;
    role: 'ADMIN' | 'MEMBER';
  }) {
    await this.requireRole(input.actorId, input.groupId, ['OWNER']);
    const target = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: input.groupId, userId: input.userId } },
    });
    if (!target || target.leftAt) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'member not in this group' });
    }
    if (target.role === 'OWNER') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'cannot change owner role' });
    }
    await this.prisma.groupMember.update({
      where: { groupId_userId: { groupId: input.groupId, userId: input.userId } },
      data: { role: input.role },
    });
  }

  /** Throws if the user isn't a current member with one of the allowed roles. */
  async requireRole(
    userId: string,
    groupId: string,
    allowed: Array<'OWNER' | 'ADMIN' | 'MEMBER'>,
  ) {
    const member = await this.prisma.groupMember.findFirst({
      where: { groupId, userId, leftAt: null },
    });
    if (!member) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'not a member of this group' });
    }
    if (!allowed.includes(member.role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `requires role ${allowed.join(' or ')}`,
      });
    }
    return member;
  }
}
