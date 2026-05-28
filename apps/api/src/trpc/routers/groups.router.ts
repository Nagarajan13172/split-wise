import { z } from 'zod';
import {
  zGroupCreate,
  zGroupUpdate,
  zCreateInvite,
  zAcceptInvite,
  zRemoveMember,
  zUpdateMemberRole,
} from '@split-wise/shared';
import { router, protectedProcedure, publicProcedure } from '../trpc.js';
import { type GroupsService } from '../../modules/groups/groups.service.js';
import { type InvitesService } from '../../modules/groups/invites.service.js';
import { type UsersService } from '../../modules/users/users.service.js';

let groupsService: GroupsService;
let invitesService: InvitesService;
let usersService: UsersService;

export function attachGroupsServices(s: {
  groups: GroupsService;
  invites: InvitesService;
  users: UsersService;
}) {
  groupsService = s.groups;
  invitesService = s.invites;
  usersService = s.users;
}

export const groupsRouter = router({
  create: protectedProcedure.input(zGroupCreate).mutation(async ({ ctx, input }) => {
    const group = await groupsService.create({
      actorId: ctx.user.id,
      name: input.name,
      defaultCurrency: input.defaultCurrency,
      simplifyDebts: input.simplifyDebts,
    });
    return { id: group.id, name: group.name };
  }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const groups = await groupsService.listForUser(ctx.user.id);
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      defaultCurrency: g.defaultCurrency,
      memberCount: g.members.length,
      members: g.members.map((m) => ({
        id: m.user.id,
        displayName: m.user.displayName,
        role: m.role,
      })),
    }));
  }),

  get: protectedProcedure
    .input(z.object({ groupId: z.string() }))
    .query(async ({ ctx, input }) => {
      const g = await groupsService.getDetail(ctx.user.id, input.groupId);
      return {
        id: g.id,
        name: g.name,
        defaultCurrency: g.defaultCurrency,
        simplifyDebts: g.simplifyDebts,
        myRole: g.myRole,
        createdAt: g.createdAt.toISOString(),
        members: g.members.map((m) => ({
          id: m.user.id,
          displayName: m.user.displayName,
          email: m.user.email,
          role: m.role,
          joinedAt: m.joinedAt.toISOString(),
        })),
      };
    }),

  update: protectedProcedure
    .input(zGroupUpdate.extend({ groupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { groupId, ...rest } = input;
      await groupsService.update({ actorId: ctx.user.id, groupId, ...rest });
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ groupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await groupsService.softDelete(ctx.user.id, input.groupId);
      return { ok: true };
    }),

  leave: protectedProcedure
    .input(z.object({ groupId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await groupsService.leave(ctx.user.id, input.groupId);
      return { ok: true };
    }),

  removeMember: protectedProcedure.input(zRemoveMember).mutation(async ({ ctx, input }) => {
    await groupsService.removeMember({ actorId: ctx.user.id, ...input });
    return { ok: true };
  }),

  updateMemberRole: protectedProcedure
    .input(zUpdateMemberRole)
    .mutation(async ({ ctx, input }) => {
      await groupsService.updateMemberRole({ actorId: ctx.user.id, ...input });
      return { ok: true };
    }),

  // --- invites ---

  createInvite: protectedProcedure.input(zCreateInvite).mutation(async ({ ctx, input }) => {
    return invitesService.create({
      actorId: ctx.user.id,
      groupId: input.groupId,
      email: input.email,
      expiresInHours: input.expiresInHours,
    });
  }),

  listInvites: protectedProcedure
    .input(z.object({ groupId: z.string() }))
    .query(async ({ ctx, input }) => invitesService.listForGroup(ctx.user.id, input.groupId)),

  revokeInvite: protectedProcedure
    .input(z.object({ inviteId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await invitesService.revoke({ actorId: ctx.user.id, inviteId: input.inviteId });
      return { ok: true };
    }),

  /** Public: lets the acceptance page show the group name before the user signs in. */
  previewInvite: publicProcedure.input(zAcceptInvite).query(async ({ input }) => {
    return invitesService.preview(input.token);
  }),

  acceptInvite: protectedProcedure.input(zAcceptInvite).mutation(async ({ ctx, input }) => {
    const user = await usersService.findById(ctx.user.id);
    if (!user) throw new Error('user not found');
    return invitesService.accept({
      actorId: ctx.user.id,
      actorEmail: user.email,
      rawToken: input.token,
    });
  }),
});
