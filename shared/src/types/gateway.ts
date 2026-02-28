// @discord/shared — Gateway (READY event) types
//
// ⭐ THIS IS THE SINGLE MOST IMPORTANT TYPE IN THE CODEBASE.
// The READY payload bootstraps the entire UI in one shot.
//
// WHAT'S INCLUDED:
//   ✅ User profile
//   ✅ Server metadata (id, name, icon, ownerId)
//   ✅ Channels per server
//   ✅ Voice states (max 50 per room — always small)
//   ✅ Online member COUNT per server (a single integer)
//   ✅ Presence map (from Redis/in-memory, NOT SQL)
//
// WHAT'S EXCLUDED:
//   ❌ Member arrays — fetched lazily via tRPC server.getMembers (Section 5.3.2)
//   ❌ Message history — loaded on channel click via tRPC message.getHistory

import type { ServerWithChannels } from './server.js';
import type { UserProfile } from './user.js';

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';

export interface ReadyPayload {
  user: UserProfile & { email: string };
  servers: ServerWithChannels[];
  /** Assembled from Redis/in-memory Map, NOT from SQL (Section 7.3) */
  presenceMap: Record<string, PresenceStatus>;
}

/** Events that can be queued during hydration (Section 6.2 earlyEventQueue) */
export type QueuedEventType =
  | 'message:new'
  | 'message:updated'
  | 'message:deleted'
  | 'presence:changed'
  | 'typing:update'
  | 'server:member-joined'
  | 'server:member-left'
  | 'channel:created'
  | 'channel:deleted'
  | 'voice:user-joined'
  | 'voice:user-left'
  | 'voice:reconciled';

export interface QueuedEvent {
  type: QueuedEventType;
  payload: unknown;
}
