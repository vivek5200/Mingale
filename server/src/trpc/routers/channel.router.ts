// server/src/trpc/routers/channel.router.ts — Channel CRUD mutations

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t, protectedProcedure } from '../trpc.js';
import { findMembership } from '../../models/server.model.js';
import {
  findChannelById,
  createChannel,
  updateChannel,
  deleteChannel,
} from '../../models/channel.model.js';

export const channelRouter = t.router({
  /** Create a channel in a server (admin+ only) */
  create: protectedProcedure
    .input(
      z.object({
        serverId: z.string().uuid(),
        name: z.string().min(1).max(100).trim(),
        type: z.enum(['text', 'voice']).default('text'),
        topic: z.string().max(1024).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const membership = await findMembership(ctx.userId, input.serverId);
      if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
      }

      const channel = await createChannel(
        input.serverId,
        input.name,
        input.type,
        input.topic,
      );

      return {
        id: channel.id,
        serverId: channel.server_id,
        name: channel.name,
        topic: channel.topic,
        type: channel.type,
        position: channel.position,
      };
    }),

  /** Update a channel (admin+ only) */
  update: protectedProcedure
    .input(
      z.object({
        channelId: z.string().uuid(),
        name: z.string().min(1).max(100).trim().optional(),
        topic: z.string().max(1024).nullish(),
        position: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const channel = await findChannelById(input.channelId);
      if (!channel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      }

      const membership = await findMembership(ctx.userId, channel.server_id);
      if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
      }

      const updated = await updateChannel(input.channelId, {
        name: input.name,
        topic: input.topic,
        position: input.position,
      });

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      }

      return {
        id: updated.id,
        serverId: updated.server_id,
        name: updated.name,
        topic: updated.topic,
        type: updated.type,
        position: updated.position,
      };
    }),

  /** Delete a channel (admin+ only) — CASCADE deletes messages + voice_states */
  delete: protectedProcedure
    .input(z.object({ channelId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const channel = await findChannelById(input.channelId);
      if (!channel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      }

      const membership = await findMembership(ctx.userId, channel.server_id);
      if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
      }

      await deleteChannel(input.channelId);
      return { success: true };
    }),
});
