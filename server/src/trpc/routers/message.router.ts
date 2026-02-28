// server/src/trpc/routers/message.router.ts — Message queries with cursor pagination

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t, protectedProcedure } from '../trpc.js';
import { findMembership } from '../../models/server.model.js';
import { findChannelById } from '../../models/channel.model.js';
import { getMessages } from '../../models/message.model.js';

export const messageRouter = t.router({
  /**
   * Cursor-paginated message history (Section 5.3, Optimization #2).
   * Uses created_at DESC + cursor. NEVER uses OFFSET.
   */
  getHistory: protectedProcedure
    .input(
      z.object({
        channelId: z.string().uuid(),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      // Verify channel exists
      const channel = await findChannelById(input.channelId);
      if (!channel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Channel not found' });
      }

      // Verify requesting user is a member of the server
      const membership = await findMembership(ctx.userId, channel.server_id);
      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not a member of this server' });
      }

      const rows = await getMessages(input.channelId, input.limit, input.cursor);

      const hasMore = rows.length > input.limit;
      const messages = rows.slice(0, input.limit).map((row) => ({
        id: row.id,
        channelId: row.channel_id,
        userId: row.user_id,
        content: row.content,
        type: row.type,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        author: {
          id: row.user_id,
          username: row.username,
          avatarUrl: row.avatar_url,
        },
      }));

      const nextCursor = hasMore
        ? messages[messages.length - 1].createdAt
        : null;

      return { messages, nextCursor };
    }),
});
