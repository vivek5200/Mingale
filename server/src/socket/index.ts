// server/src/socket/index.ts — Socket.io initialization + READY event lifecycle
//
// Implements Section 7.1 "Connection Lifecycle" with the Hydration Gap fix:
//   1. Server emits READY BEFORE joining broadcast rooms
//   2. Client buffers events, hydrates Zustand, then emits 'ready:ack'
//   3. Server joins rooms and broadcasts presence ONLY after 'ready:ack'

import { Server as SocketServer, Socket } from 'socket.io';
import { verifyToken } from '../services/auth.service.js';
import { assembleReadyPayload } from '../services/gateway.service.js';
import { setPresence, removePresence } from '../services/presence.service.js';
import { logger } from '../utils/logger.js';

export function registerSocketHandlers(io: SocketServer): void {
  // JWT auth middleware (Section 3.1, socketAuth.ts)
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = verifyToken(token);
      socket.data.userId = decoded.userId;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const userId = socket.data.userId as string;
    logger.info(`Socket connected: ${socket.id} (user: ${userId})`);

    try {
      // Step 4a: Build READY payload (one SQL query + presence stitch)
      const readyPayload = await assembleReadyPayload(userId);

      // Step 4b: Join personal room only (safe — only DMs come here)
      socket.join(`user:${userId}`);

      // Step 4c: Send READY — DO NOT join server/channel rooms yet!
      // Client needs time to hydrate Zustand (Section 7.1 "Hydration Gap")
      socket.emit('ready', readyPayload);

      // Step 4d: Update presence (but don't broadcast yet)
      setPresence(userId, socket.id, 'online');

      // Step 6: Wait for client to finish hydration
      socket.once('ready:ack', () => {
        // Step 6a-b: NOW join all broadcast rooms
        for (const server of readyPayload.servers) {
          socket.join(`server:${server.id}`);
          for (const channel of server.channels) {
            socket.join(`channel:${channel.id}`);
          }
        }

        // Step 6c: NOW broadcast presence to all servers
        for (const server of readyPayload.servers) {
          io.to(`server:${server.id}`).emit('presence:changed', {
            userId,
            status: 'online',
          });
        }

        logger.debug(`User ${userId} fully hydrated, joined ${readyPayload.servers.length} servers`);
      });

      // --- Real-time message handling ---
      socket.on('message:send', async (data: { channelId: string; content: string }) => {
        try {
          const { createMessage } = await import('../models/message.model.js');
          const message = await createMessage(data.channelId, userId, data.content);

          const payload = {
            id: message.id,
            channelId: message.channel_id,
            userId: message.user_id,
            content: message.content,
            type: message.type,
            createdAt: message.created_at.toISOString(),
            updatedAt: message.updated_at.toISOString(),
            author: {
              id: message.user_id,
              username: message.username,
              avatarUrl: message.avatar_url,
            },
          };

          // Broadcast to all sockets in the channel room
          io.to(`channel:${data.channelId}`).emit('message:new', payload);
        } catch (err) {
          logger.error(`Error handling message:send from ${userId}: ${err}`);
          socket.emit('error', { message: 'Failed to send message' });
        }
      });

      // --- Typing indicators ---
      socket.on('typing:start', (data: { channelId: string }) => {
        socket.to(`channel:${data.channelId}`).emit('typing:update', {
          channelId: data.channelId,
          userId,
        });
      });

      // --- Presence updates ---
      socket.on('presence:update', (data: { status: 'online' | 'idle' | 'dnd' }) => {
        setPresence(userId, socket.id, data.status);
        // Broadcast to all servers the user is in
        for (const room of socket.rooms) {
          if (room.startsWith('server:')) {
            io.to(room).emit('presence:changed', { userId, status: data.status });
          }
        }
      });

      // --- Disconnect ---
      socket.on('disconnect', () => {
        logger.info(`Socket disconnected: ${socket.id} (user: ${userId})`);
        removePresence(userId);

        // Broadcast offline to all servers
        for (const room of socket.rooms) {
          if (room.startsWith('server:')) {
            io.to(room).emit('presence:changed', { userId, status: 'offline' });
          }
        }
      });
    } catch (err) {
      logger.error(`Error during connection for user ${userId}: ${err}`);
      socket.emit('error', { message: 'Failed to initialize connection' });
      socket.disconnect();
    }
  });
}
