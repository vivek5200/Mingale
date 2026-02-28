// server/src/models/voiceState.model.ts — SQL queries for voice_states table

import { pool } from '../config/database.js';

export interface VoiceStateRow {
  id: string;
  channel_id: string;
  user_id: string;
  session_id: string;
  self_mute: boolean;
  self_deaf: boolean;
  joined_at: Date;
}

/**
 * Upsert voice state — ON CONFLICT atomically moves user (Optimization #3).
 * Before calling this, the caller MUST do a pre-emptive kick check
 * (see Section 3.3, voice.getTicket — "Phantom Listener" prevention).
 */
export async function upsertVoiceState(
  channelId: string,
  userId: string,
  sessionId: string,
): Promise<VoiceStateRow> {
  const result = await pool.query<VoiceStateRow>(
    `INSERT INTO voice_states (channel_id, user_id, session_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
     SET channel_id = EXCLUDED.channel_id,
         session_id = EXCLUDED.session_id,
         self_mute  = FALSE,
         self_deaf  = FALSE,
         joined_at  = NOW()
     RETURNING *`,
    [channelId, userId, sessionId],
  );
  return result.rows[0];
}

export async function removeVoiceState(userId: string): Promise<VoiceStateRow | null> {
  const result = await pool.query<VoiceStateRow>(
    'DELETE FROM voice_states WHERE user_id = $1 RETURNING *',
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function findVoiceStateByUserId(
  userId: string,
): Promise<VoiceStateRow | null> {
  const result = await pool.query<VoiceStateRow>(
    'SELECT * FROM voice_states WHERE user_id = $1',
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function findVoiceStatesByChannelId(
  channelId: string,
): Promise<VoiceStateRow[]> {
  const result = await pool.query<VoiceStateRow>(
    'SELECT * FROM voice_states WHERE channel_id = $1',
    [channelId],
  );
  return result.rows;
}
