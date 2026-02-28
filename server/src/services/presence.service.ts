// server/src/services/presence.service.ts — In-memory presence tracking (Phase 3)
//
// ⚠️ Presence is NEVER stored in PostgreSQL (Section 7.3 "Presence Paradox").
// Phase 3: In-memory Map (this file)
// Phase 3+: Replace with Redis HSET (see ARCHITECTURE.md Section 7.3)

import type { PresenceStatus } from '@discord/shared';

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
 * Build presenceMap + onlineMemberCount for the READY payload (Section 7.3).
 * Takes an array of { serverId, userId } pairs and returns:
 *   - presenceMap: Record<userId, status> for all online users
 *   - onlineCountByServer: Map<serverId, count>
 */
export function assemblePresenceData(
  allMembers: Array<{ serverId: string; userId: string }>,
): {
  presenceMap: Record<string, PresenceStatus>;
  onlineCountByServer: Map<string, number>;
} {
  const presenceMap: Record<string, PresenceStatus> = {};
  const onlineCountByServer = new Map<string, number>();

  for (const { serverId, userId } of allMembers) {
    const entry = presenceStore.get(userId);
    if (entry && entry.status !== 'offline') {
      presenceMap[userId] = entry.status;
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
