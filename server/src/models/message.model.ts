// server/src/models/message.model.ts — SQL queries for messages table

import { pool } from '../config/database.js';

export interface MessageRow {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  type: 'text' | 'image' | 'system';
  created_at: Date;
  updated_at: Date;
}

export interface MessageWithAuthor extends MessageRow {
  username: string;
  avatar_url: string | null;
}

/** Create a message */
export async function createMessage(
  channelId: string,
  userId: string,
  content: string,
  type: 'text' | 'image' | 'system' = 'text',
): Promise<MessageWithAuthor> {
  const result = await pool.query<MessageWithAuthor>(
    `INSERT INTO messages (channel_id, user_id, content, type)
     VALUES ($1, $2, $3, $4)
     RETURNING *,
       (SELECT username FROM users WHERE id = $2) AS username,
       (SELECT avatar_url FROM users WHERE id = $2) AS avatar_url`,
    [channelId, userId, content, type],
  );
  return result.rows[0];
}

/**
 * Cursor-based paginated message history (Optimization #2).
 * ORDER BY created_at DESC — most recent first.
 * Uses the idx_messages_channel_cursor index.
 */
export async function getMessages(
  channelId: string,
  limit: number,
  cursor?: string,
): Promise<MessageWithAuthor[]> {
  const values: unknown[] = [channelId, limit + 1];
  let cursorClause = '';

  if (cursor) {
    cursorClause = 'AND m.created_at < $3';
    values.push(cursor);
  }

  const result = await pool.query<MessageWithAuthor>(
    `SELECT m.*, u.username, u.avatar_url
     FROM messages m
     JOIN users u ON u.id = m.user_id
     WHERE m.channel_id = $1
       ${cursorClause}
     ORDER BY m.created_at DESC
     LIMIT $2`,
    values,
  );

  return result.rows;
}

/** Update message content (author only) */
export async function updateMessage(
  id: string,
  content: string,
): Promise<MessageRow | null> {
  const result = await pool.query<MessageRow>(
    `UPDATE messages SET content = $1 WHERE id = $2 RETURNING *`,
    [content, id],
  );
  return result.rows[0] ?? null;
}

/** Delete a message */
export async function deleteMessage(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM messages WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/** Find a message by ID */
export async function findMessageById(id: string): Promise<MessageRow | null> {
  const result = await pool.query<MessageRow>(
    'SELECT * FROM messages WHERE id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}
