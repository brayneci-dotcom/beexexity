import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from './index.js';

/**
 * PostgreSQL connection pool configured for GCP Cloud SQL (public IP).
 * Uses settings from the application config (environment variables or defaults).
 */
export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DB_SSL === 'false' ? false : (config.database.host !== 'localhost' ? { rejectUnauthorized: false } : false),
});

/**
 * Execute a query against the connection pool.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

/**
 * Gracefully shut down the pool (for clean server shutdown).
 */
export async function closePool(): Promise<void> {
  await pool.end();
}

// ─── Distributed Locking (PostgreSQL Advisory Locks) ──────────────────────────
//
// Replaces the in-memory Map-based turn lock. Advisory locks work across all
// Cloud Run instances because they share the same Cloud SQL.
//
// The lock key is derived from the session UUID (first 8 hex chars → int4).
// This is collision-safe for session-level granularity.
//
// Locks are automatically released when the database connection is closed
// (crash-safe). However, always call unlock() explicitly in a finally block
// to avoid leaking connections in the pool.

/** Convert a UUID string to a 32-bit integer lock key. */
function uuidToLockKey(uuid: string): number {
  const hex = uuid.replace(/-/g, '').slice(0, 8);
  return parseInt(hex, 16);
}

/**
 * Try to acquire a PostgreSQL advisory lock for a session.
 * Uses a dedicated connection so acquire and release happen on the same
 * connection — advisory locks are per-connection in PostgreSQL.
 *
 * Non-blocking — returns false immediately if another instance holds the lock.
 * Returns a release function that must be called in a finally block.
 *
 * @returns { locked, release } — locked=true if acquired, release() to unlock.
 */
export async function tryAcquireSessionLock(sessionId: string): Promise<{ locked: boolean; release: () => Promise<void> }> {
  const key = uuidToLockKey(sessionId);
  let client: PoolClient | undefined;

  try {
    client = await pool.connect();
    const result = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [key],
    );
    const locked = result.rows[0]?.locked === true;

    if (!locked) {
      client.release();
      return { locked: false, release: async () => {} };
    }

    return {
      locked: true,
      release: async () => {
        try {
          await client!.query('SELECT pg_advisory_unlock($1)', [key]);
        } catch (error) {
          console.error('[database] Failed to release session lock:', (error as Error).message);
        } finally {
          client!.release();
        }
      },
    };
  } catch (error) {
    if (client) client.release();
    console.error('[database] Failed to acquire session lock:', (error as Error).message);
    return { locked: false, release: async () => {} }; // Fail-open
  }
}
