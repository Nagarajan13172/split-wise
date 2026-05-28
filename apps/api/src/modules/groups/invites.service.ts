import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { EmailService } from '../../common/email/email.service.js';
import { TokensService } from '../auth/tokens.service.js';
import { UsersService } from '../users/users.service.js';
import { loadEnv } from '../../config/env.js';
import { GroupsService } from './groups.service.js';

@Injectable()
export class InvitesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(GroupsService) private readonly groups: GroupsService,
  ) {}

  async create(input: {
    actorId: string;
    groupId: string;
    email?: string;
    expiresInHours: number;
  }) {
    await this.groups.requireRole(input.actorId, input.groupId, ['OWNER', 'ADMIN']);

    const raw = crypto.randomBytes(32).toString('base64url');
    const tokenHash = this.tokens.hashToken(raw);
    const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000);

    const invite = await this.prisma.groupInvite.create({
      data: {
        groupId: input.groupId,
        email: input.email?.toLowerCase(),
        tokenHash,
        invitedById: input.actorId,
        expiresAt,
      },
      include: { group: true },
    });

    const url = `${loadEnv().APP_BASE_URL}/invite/${encodeURIComponent(raw)}`;

    // For email-bound invites, send the email immediately.
    if (input.email) {
      const inviter = await this.users.findById(input.actorId);
      const inviterName = inviter?.displayName ?? inviter?.email ?? 'someone';
      await this.email.send({
        to: input.email,
        subject: `${inviterName} invited you to "${invite.group.name}" on Splitwise`,
        text:
          `${inviterName} invited you to join the group "${invite.group.name}" on Splitwise.\n\n` +
          `Accept here (expires ${expiresAt.toISOString().slice(0, 10)}):\n${url}\n`,
        html:
          `<p><strong>${inviterName}</strong> invited you to join the group <strong>"${invite.group.name}"</strong> on Splitwise.</p>` +
          `<p><a href="${url}">Accept invitation</a></p>` +
          `<p style="color:#64748b;font-size:12px">Link expires ${expiresAt.toISOString().slice(0, 10)}.</p>`,
      });
    }

    return {
      id: invite.id,
      url,
      email: invite.email,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  /** Inspect an invite without consuming it — used by the acceptance page to render the group name. */
  async preview(rawToken: string) {
    const tokenHash = this.tokens.hashToken(rawToken);
    const invite = await this.prisma.groupInvite.findUnique({
      where: { tokenHash },
      include: { group: true, invitedBy: { select: { displayName: true, email: true } } },
    });
    if (!invite) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'invite not found' });
    }
    if (invite.group.deletedAt) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'group no longer exists' });
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'invite expired' });
    }
    if (invite.email && invite.acceptedAt) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'invite already used' });
    }
    return {
      groupId: invite.group.id,
      groupName: invite.group.name,
      defaultCurrency: invite.group.defaultCurrency,
      restrictedToEmail: invite.email,
      invitedBy: invite.invitedBy.displayName ?? invite.invitedBy.email,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  async accept(input: { actorId: string; rawToken: string; actorEmail: string }) {
    const tokenHash = this.tokens.hashToken(input.rawToken);
    const invite = await this.prisma.groupInvite.findUnique({
      where: { tokenHash },
      include: { group: true },
    });
    if (!invite) throw new TRPCError({ code: 'NOT_FOUND', message: 'invite not found' });
    if (invite.group.deletedAt) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'group no longer exists' });
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'invite expired' });
    }
    if (invite.email) {
      if (invite.acceptedAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'invite already used' });
      }
      if (invite.email !== input.actorEmail.toLowerCase()) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'this invite is restricted to a different email',
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Re-join if previously left; otherwise idempotent if already an active member.
      const existing = await tx.groupMember.findUnique({
        where: { groupId_userId: { groupId: invite.groupId, userId: input.actorId } },
      });
      if (existing && !existing.leftAt) {
        // Already a member — no-op but still mark email invite consumed.
        if (invite.email) {
          await tx.groupInvite.update({
            where: { id: invite.id },
            data: { acceptedAt: new Date() },
          });
        }
        return { groupId: invite.groupId, alreadyMember: true };
      }
      if (existing) {
        await tx.groupMember.update({
          where: { groupId_userId: { groupId: invite.groupId, userId: input.actorId } },
          data: { leftAt: null, role: 'MEMBER', joinedAt: new Date() },
        });
      } else {
        await tx.groupMember.create({
          data: { groupId: invite.groupId, userId: input.actorId, role: 'MEMBER' },
        });
      }
      if (invite.email) {
        await tx.groupInvite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        });
      }
      return { groupId: invite.groupId, alreadyMember: false };
    });
  }

  async revoke(input: { actorId: string; inviteId: string }) {
    const invite = await this.prisma.groupInvite.findUnique({ where: { id: input.inviteId } });
    if (!invite) throw new TRPCError({ code: 'NOT_FOUND', message: 'invite not found' });
    await this.groups.requireRole(input.actorId, invite.groupId, ['OWNER', 'ADMIN']);
    await this.prisma.groupInvite.delete({ where: { id: invite.id } });
  }

  async listForGroup(actorId: string, groupId: string) {
    await this.groups.requireRole(actorId, groupId, ['OWNER', 'ADMIN']);
    const invites = await this.prisma.groupInvite.findMany({
      where: { groupId },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((i) => ({
      id: i.id,
      email: i.email,
      createdAt: i.createdAt.toISOString(),
      expiresAt: i.expiresAt.toISOString(),
      acceptedAt: i.acceptedAt?.toISOString() ?? null,
      expired: i.expiresAt.getTime() < Date.now(),
    }));
  }
}
