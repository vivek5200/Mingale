// server/src/config/database.ts — PostgreSQL connection pool

import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,                    // Max pool size (Section 11.6 #5)
  idleTimeoutMillis: 30000,   // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Fail fast if pool is full
});

// Log connection status
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
  process.exit(1);
});

// Verify connection on startup
export async function connectDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT NOW()');
    console.log(`✅ PostgreSQL connected at ${result.rows[0].now}`);
  } finally {
    client.release();
  }
}
