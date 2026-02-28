// server/src/models/channel.model.ts — SQL queries for channels table

import { pool } from '../config/database.js';

export interface ChannelRow {
  id: string;
  server_id: string;
  name: string;
  topic: string | null;
  type: 'text' | 'voice';
  position: number;
  created_at: Date;
  updated_at: Date;
}

export async function findChannelById(id: string): Promise<ChannelRow | null> {
  const result = await pool.query<ChannelRow>(
    'SELECT * FROM channels WHERE id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findChannelsByServerId(
  serverId: string,
): Promise<ChannelRow[]> {
  const result = await pool.query<ChannelRow>(
    'SELECT * FROM channels WHERE server_id = $1 ORDER BY position ASC',
    [serverId],
  );
  return result.rows;
}

export async function createChannel(
  serverId: string,
  name: string,
  type: 'text' | 'voice' = 'text',
  topic?: string | null,
): Promise<ChannelRow> {
  // Auto-calculate position: put at the end
  const posResult = await pool.query<{ max: number | null }>(
    'SELECT MAX(position) as max FROM channels WHERE server_id = $1',
    [serverId],
  );
  const nextPosition = (posResult.rows[0].max ?? -1) + 1;

  const result = await pool.query<ChannelRow>(
    `INSERT INTO channels (server_id, name, type, topic, position)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [serverId, name, type, topic ?? null, nextPosition],
  );
  return result.rows[0];
}

export async function updateChannel(
  id: string,
  fields: { name?: string; topic?: string | null; position?: number },
): Promise<ChannelRow | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (fields.name !== undefined) {
    updates.push(`name = $${idx++}`);
    values.push(fields.name);
  }
  if (fields.topic !== undefined) {
    updates.push(`topic = $${idx++}`);
    values.push(fields.topic);
  }
  if (fields.position !== undefined) {
    updates.push(`position = $${idx++}`);
    values.push(fields.position);
  }

  if (updates.length === 0) return findChannelById(id);

  values.push(id);
  const result = await pool.query<ChannelRow>(
    `UPDATE channels SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

export async function deleteChannel(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM channels WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}
