// server/src/trpc/routers/server.router.ts — Server CRUD + join-by-invite + lazy member loading

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t, protectedProcedure } from '../trpc.js';
import { createInviteCode } from '../../utils/helpers.js';
import {
  createServerWithOwner,
  findServerById,
  findServerByInviteCode,
  updateServer,
  deleteServer,
  findMembership,
  addMember,
  removeMember,
  getMembers,
} from '../../models/server.model.js';

export const serverRouter = t.router({
  /** Create a new server — caller becomes owner, #general channel auto-created */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100).trim(),
        iconUrl: z.string().url().nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const inviteCode = createInviteCode();
      const server = await createServerWithOwner(
        input.name,
        ctx.userId,
        inviteCode,
        input.iconUrl,
      );

      return {
        id: server.id,
        name: server.name,
        iconUrl: server.icon_url,
        ownerId: server.owner_id,
        inviteCode: server.invite_code,
      };
    }),

  /** Update server metadata (owner or admin only) */
  update: protectedProcedure
    .input(
      z.object({
        serverId: z.string().uuid(),
        name: z.string().min(1).max(100).trim().optional(),
        iconUrl: z.string().url().nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const membership = await findMembership(ctx.userId, input.serverId);
      if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
      }

      const updated = await updateServer(input.serverId, {
        name: input.name,
        iconUrl: input.iconUrl,
      });

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Server not found' });
      }

      return {
        id: updated.id,
        name: updated.name,
        iconUrl: updated.icon_url,
        ownerId: updated.owner_id,
        inviteCode: updated.invite_code,
      };
    }),

  /** Delete a server (owner only) — CASCADE deletes all channels, members, messages */
  delete: protectedProcedure
    .input(z.object({ serverId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const server = await findServerById(input.serverId);
      if (!server) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Server not found' });
      }
      if (server.owner_id !== ctx.userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owner can delete a server' });
      }

      await deleteServer(input.serverId);
      return { success: true };
    }),

  /** Join a server via invite code */
  join: protectedProcedure
    .input(z.object({ inviteCode: z.string().min(1).max(20).trim() }))
    .mutation(async ({ input, ctx }) => {
      const server = await findServerByInviteCode(input.inviteCode);
      if (!server) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invalid invite code' });
      }

      // Check if already a member
      const existing = await findMembership(ctx.userId, server.id);
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'You are already a member of this server' });
      }

      await addMember(ctx.userId, server.id);

      return {
        id: server.id,
        name: server.name,
        iconUrl: server.icon_url,
        ownerId: server.owner_id,
        inviteCode: server.invite_code,
      };
    }),

  /** Leave a server (owner cannot leave — must delete or transfer ownership) */
  leave: protectedProcedure
    .input(z.object({ serverId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const server = await findServerById(input.serverId);
      if (!server) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Server not found' });
      }
      if (server.owner_id === ctx.userId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The owner cannot leave. Transfer ownership or delete the server.',
        });
      }

      const removed = await removeMember(ctx.userId, input.serverId);
      if (!removed) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'You are not a member of this server' });
      }

      return { success: true };
    }),

  /**
   * Lazy-loaded member list — cursor-paginated (Section 5.3.2)
   * Called when user clicks on a server in the sidebar.
   * NOT included in READY payload (prevents "JSON Bomb").
   */
  getMembers: protectedProcedure
    .input(
      z.object({
        serverId: z.string().uuid(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(200).default(100),
      }),
    )
    .query(async ({ input, ctx }) => {
      // Verify requesting user is a member
      const membership = await findMembership(ctx.userId, input.serverId);
      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not a member of this server' });
      }

      const rows = await getMembers(input.serverId, input.limit, input.cursor);

      const hasMore = rows.length > input.limit;
      const members = rows.slice(0, input.limit);
      const nextCursor = hasMore
        ? members[members.length - 1].joinedAt.toISOString()
        : null;

      return { members, nextCursor };
    }),
});
