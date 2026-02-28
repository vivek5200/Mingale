// server/src/services/gateway.service.ts — Assembles the READY payload
//
// ⭐ THE SINGLE MOST IMPORTANT FUNCTION IN THE ENTIRE APP.
//
// This runs ONE optimized SQL query that JOINs server_members → servers →
// channels → voice_states, then stitches presence from in-memory/Redis.
//
// WHAT'S INCLUDED: user, servers, channels, voice_states, memberCount, presenceMap
// WHAT'S EXCLUDED: member arrays (fetched lazily — see Section 5.3.2)

import { pool } from '../config/database.js';
import { findUserById } from '../models/user.model.js';
import { assemblePresenceData } from './presence.service.js';
import type { ReadyPayload, ServerWithChannels } from '@discord/shared';

/**
 * The gateway SQL query — ONE query, full payload (no member arrays).
 * See ARCHITECTURE.md Section 5.3 for detailed explanation.
 */
const READY_SQL = `
SELECT
  s.id, s.name, s.icon_url, s.owner_id, s.invite_code,
  (
    SELECT COALESCE(json_agg(json_build_object(
      'id', c.id, 'name', c.name, 'type', c.type,
      'topic', c.topic, 'position', c.position,
      'serverId', c.server_id,
      'createdAt', c.created_at,
      'updatedAt', c.updated_at
    ) ORDER BY c.position), '[]'::json)
    FROM channels c WHERE c.server_id = s.id
  ) AS channels,
  (
    SELECT COUNT(*)::int
    FROM server_members sm2
    WHERE sm2.server_id = s.id
  ) AS member_count,
  (
    SELECT COALESCE(json_agg(json_build_object(
      'channelId', vs.channel_id, 'userId', vs.user_id,
      'selfMute', vs.self_mute, 'selfDeaf', vs.self_deaf
    )), '[]'::json)
    FROM voice_states vs
    JOIN channels vc ON vc.id = vs.channel_id
    WHERE vc.server_id = s.id
  ) AS voice_states
FROM server_members sm
JOIN servers s ON s.id = sm.server_id
WHERE sm.user_id = $1;
`;

/**
 * Query to get ALL member IDs across all of the user's servers.
 * Used by assemblePresenceData() to build presenceMap + onlineMemberCount.
 */
const ALL_MEMBERS_SQL = `
SELECT DISTINCT sm2.user_id AS "userId", sm2.server_id AS "serverId"
FROM server_members sm
JOIN server_members sm2 ON sm2.server_id = sm.server_id
WHERE sm.user_id = $1;
`;

interface GatewayServerRow {
  id: string;
  name: string;
  icon_url: string | null;
  owner_id: string;
  invite_code: string;
  channels: Array<{
    id: string;
    name: string;
    type: 'text' | 'voice';
    topic: string | null;
    position: number;
    serverId: string;
    createdAt: string;
    updatedAt: string;
  }>;
  member_count: number;
  voice_states: Array<{
    channelId: string;
    userId: string;
    selfMute: boolean;
    selfDeaf: boolean;
  }>;
}

/**
 * Assemble the complete READY payload for a user.
 * This is called on Socket.io connection after JWT verification.
 *
 * Flow (Section 7.3 "Hybrid Assembly"):
 *   1. SQL: servers, channels, member counts, voice states
 *   2. Presence: read from in-memory Map (Phase 3) or Redis (Phase 3+)
 *   3. Stitch together in Node.js → return as ReadyPayload
 */
export async function assembleReadyPayload(
  userId: string,
): Promise<ReadyPayload> {
  // 1. Get user profile
  const user = await findUserById(userId);
  if (!user) {
    throw new Error(`User ${userId} not found during READY assembly`);
  }

  // 2. Run the gateway SQL query (ONE query — all servers, channels, voice states)
  const serverResult = await pool.query<GatewayServerRow>(READY_SQL, [userId]);

  // 3. Get all member IDs for presence assembly
  const memberResult = await pool.query<{ userId: string; serverId: string }>(
    ALL_MEMBERS_SQL,
    [userId],
  );

  // 4. Assemble presence from in-memory Map (Section 7.3)
  const { presenceMap, onlineCountByServer } = assemblePresenceData(
    memberResult.rows,
  );

  // 5. Stitch SQL + Presence into ReadyPayload
  const servers: ServerWithChannels[] = serverResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    iconUrl: row.icon_url,
    ownerId: row.owner_id,
    inviteCode: row.invite_code,
    channels: row.channels ?? [],
    memberCount: row.member_count,
    onlineMemberCount: onlineCountByServer.get(row.id) ?? 0,
    voiceStates: row.voice_states ?? [],
  }));

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatar_url,
    },
    servers,
    presenceMap,
  };
}
