// server/src/models/server.model.ts — SQL queries for servers + server_members

import { pool } from '../config/database.js';

export interface ServerRow {
  id: string;
  name: string;
  icon_url: string | null;
  owner_id: string;
  invite_code: string;
  created_at: Date;
  updated_at: Date;
}

export interface ServerMemberRow {
  id: string;
  user_id: string;
  server_id: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: Date;
}

/** Create a server + add owner as member in one transaction */
export async function createServerWithOwner(
  name: string,
  ownerId: string,
  inviteCode: string,
  iconUrl?: string | null,
): Promise<ServerRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create the server
    const serverResult = await client.query<ServerRow>(
      `INSERT INTO servers (name, owner_id, invite_code, icon_url)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, ownerId, inviteCode, iconUrl ?? null],
    );
    const server = serverResult.rows[0];

    // Add the owner as a member with 'owner' role
    await client.query(
      `INSERT INTO server_members (user_id, server_id, role)
       VALUES ($1, $2, 'owner')`,
      [ownerId, server.id],
    );

    // Create default #general text channel
    await client.query(
      `INSERT INTO channels (server_id, name, type, position)
       VALUES ($1, 'general', 'text', 0)`,
      [server.id],
    );

    await client.query('COMMIT');
    return server;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function findServerById(id: string): Promise<ServerRow | null> {
  const result = await pool.query<ServerRow>(
    'SELECT * FROM servers WHERE id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findServerByInviteCode(
  inviteCode: string,
): Promise<ServerRow | null> {
  const result = await pool.query<ServerRow>(
    'SELECT * FROM servers WHERE invite_code = $1',
    [inviteCode],
  );
  return result.rows[0] ?? null;
}

export async function updateServer(
  id: string,
  fields: { name?: string; iconUrl?: string | null },
): Promise<ServerRow | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (fields.name !== undefined) {
    updates.push(`name = $${idx++}`);
    values.push(fields.name);
  }
  if (fields.iconUrl !== undefined) {
    updates.push(`icon_url = $${idx++}`);
    values.push(fields.iconUrl);
  }

  if (updates.length === 0) return findServerById(id);

  values.push(id);
  const result = await pool.query<ServerRow>(
    `UPDATE servers SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

export async function deleteServer(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM servers WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

// --- Membership ---

export async function findMembership(
  userId: string,
  serverId: string,
): Promise<ServerMemberRow | null> {
  const result = await pool.query<ServerMemberRow>(
    'SELECT * FROM server_members WHERE user_id = $1 AND server_id = $2',
    [userId, serverId],
  );
  return result.rows[0] ?? null;
}

export async function addMember(
  userId: string,
  serverId: string,
  role: 'owner' | 'admin' | 'member' = 'member',
): Promise<ServerMemberRow> {
  const result = await pool.query<ServerMemberRow>(
    `INSERT INTO server_members (user_id, server_id, role)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, serverId, role],
  );
  return result.rows[0];
}

export async function removeMember(
  userId: string,
  serverId: string,
): Promise<boolean> {
  const result = await pool.query(
    'DELETE FROM server_members WHERE user_id = $1 AND server_id = $2',
    [userId, serverId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Get paginated member list (cursor-based, Section 5.3.2) */
export async function getMembers(
  serverId: string,
  limit: number,
  cursor?: string,
): Promise<{ userId: string; username: string; avatarUrl: string | null; role: string; joinedAt: Date }[]> {
  const values: unknown[] = [serverId, limit + 1];
  let cursorClause = '';

  if (cursor) {
    cursorClause = 'AND sm.joined_at < $3';
    values.push(cursor);
  }

  const result = await pool.query(
    `SELECT u.id AS "userId", u.username, u.avatar_url AS "avatarUrl",
            sm.role, sm.joined_at AS "joinedAt"
     FROM server_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.server_id = $1
       ${cursorClause}
     ORDER BY sm.joined_at DESC
     LIMIT $2`,
    values,
  );

  return result.rows;
}
