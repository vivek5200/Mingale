// server/src/models/user.model.ts — SQL queries for users table

import { pool } from '../config/database.js';

export interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    'SELECT * FROM users WHERE email = $1',
    [email],
  );
  return result.rows[0] ?? null;
}

export async function findUserByUsername(
  username: string,
): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    'SELECT * FROM users WHERE username = $1',
    [username],
  );
  return result.rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    'SELECT * FROM users WHERE id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}

export async function createUser(
  username: string,
  email: string,
  passwordHash: string,
): Promise<UserRow> {
  const result = await pool.query<UserRow>(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [username, email, passwordHash],
  );
  return result.rows[0];
}

export async function updateUser(
  id: string,
  fields: { username?: string; avatarUrl?: string | null },
): Promise<UserRow | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (fields.username !== undefined) {
    updates.push(`username = $${paramIndex++}`);
    values.push(fields.username);
  }
  if (fields.avatarUrl !== undefined) {
    updates.push(`avatar_url = $${paramIndex++}`);
    values.push(fields.avatarUrl);
  }

  if (updates.length === 0) return findUserById(id);

  values.push(id);
  const result = await pool.query<UserRow>(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}
