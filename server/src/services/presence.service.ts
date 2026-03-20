// server/src/services/presence.service.ts — In-memory presence tracking (Phase 3)
//
// ⚠️ Presence is NEVER stored in PostgreSQL (Section 7.3 "Presence Paradox").
// Phase 3: In-memory Map (this file)
// Phase 3+: Replace with Redis HSET/SCARD (see ARCHITECTURE.md Section 7.3)
//
// ⭐ SCALABILITY FIX: assemblePresenceData starts from the SMALL presenceStore
// (only online users) and queries ONLY their server memberships. We never pull
// the entire server_members table into Node.js memory.

import type { PresenceStatus } from '@discord/shared';
import { pool } from '../config/database.js';

interface PresenceEntry {
  socketId: string;
  status: PresenceStatus;
  lastSeen: number;
}

/** In-memory presence store — single Node.js process only */
const presenceStore = new Map<string, PresenceEntry>();

export function setPresence(
  userId: string,
  socketId: string,
  status: PresenceStatus = 'online',
): void {
  presenceStore.set(userId, { socketId, status, lastSeen: Date.now() });
}

export function removePresence(userId: string): void {
  presenceStore.delete(userId);
}

export function getPresence(userId: string): PresenceEntry | undefined {
  return presenceStore.get(userId);
}

export function getPresenceStatus(userId: string): PresenceStatus {
  const entry = presenceStore.get(userId);
  return entry?.status ?? 'offline';
}

/**
 * SQL to find which of the currently-online users belong to the given servers.
 * This is the INVERTED lookup — we start from the tiny online-user set,
 * not from the massive server_members table.
 *
 * $1 = online user IDs (UUID[]), $2 = server IDs (UUID[])
 * Result set size ≤ |online users| × |user's servers| — always small.
 */
const ONLINE_MEMBERS_SQL = `
SELECT sm.user_id AS "userId", sm.server_id AS "serverId"
FROM server_members sm
WHERE sm.user_id = ANY($1)
  AND sm.server_id = ANY($2);
`;

/**
 * Build presenceMap + onlineMemberCount for the READY payload (Section 7.3).
 *
 * INVERTED LOOKUP — instead of pulling every member from the DB:
 *   1. Read all online user IDs from the presenceStore (tiny — only active connections)
 *   2. Query DB: "which of these online users belong to the given servers?"
 *   3. Build presenceMap and onlineCountByServer from the small result
 *
 * Complexity: O(online_users) not O(total_members). Safe at any scale.
 */
export async function assemblePresenceData(
  serverIds: string[],
): Promise<{
  presenceMap: Record<string, PresenceStatus>;
  onlineCountByServer: Map<string, number>;
}> {
  const presenceMap: Record<string, PresenceStatus> = {};
  const onlineCountByServer = new Map<string, number>();

  // If no servers, return early
  if (serverIds.length === 0) {
    return { presenceMap, onlineCountByServer };
  }

  // 1. Collect all online user IDs from the in-memory store
  const onlineUserIds: string[] = [];
  const onlineStatuses = new Map<string, PresenceStatus>();

  for (const [userId, entry] of presenceStore) {
    if (entry.status !== 'offline') {
      onlineUserIds.push(userId);
      onlineStatuses.set(userId, entry.status);
    }
  }

  // If nobody is online, return early — no DB query needed
  if (onlineUserIds.length === 0) {
    return { presenceMap, onlineCountByServer };
  }

  // 2. Query DB: which of these online users belong to the given servers?
  //    Result set ≤ |onlineUserIds| × |serverIds| — always small
  const result = await pool.query<{ userId: string; serverId: string }>(
    ONLINE_MEMBERS_SQL,
    [onlineUserIds, serverIds],
  );

  // 3. Build presenceMap + onlineCountByServer from the small result
  for (const { userId, serverId } of result.rows) {
    const status = onlineStatuses.get(userId);
    if (status) {
      presenceMap[userId] = status;
      onlineCountByServer.set(
        serverId,
        (onlineCountByServer.get(serverId) ?? 0) + 1,
      );
    }
  }

  return { presenceMap, onlineCountByServer };
}

/** Get all online user IDs (for debugging/monitoring) */
export function getAllOnlineUsers(): string[] {
  return Array.from(presenceStore.entries())
    .filter(([, entry]) => entry.status !== 'offline')
    .map(([userId]) => userId);
}
