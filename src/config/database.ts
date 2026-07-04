import { Pool, QueryResult, QueryResultRow } from 'pg';
import { config } from './index.js';

/**
 * PostgreSQL connection pool configured for ap-southeast-3 RDS.
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
// Cloud Run instances because they share the same RDS.
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
 * Non-blocking — returns false immediately if another instance holds the lock.
 *
 * @returns true if lock acquired, false if already locked by another instance.
 */
export async function tryAcquireSessionLock(sessionId: string): Promise<boolean> {
  const key = uuidToLockKey(sessionId);
  try {
    const result = await query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [key],
    );
    return result.rows[0]?.locked === true;
  } catch (error) {
    console.error('[database] Failed to acquire session lock:', (error as Error).message);
    return false; // Fail-open: allow the request to proceed if DB is down
  }
}

/**
 * Release a PostgreSQL advisory lock for a session.
 * Must be called in a finally block paired with tryAcquireSessionLock().
 */
export async function releaseSessionLock(sessionId: string): Promise<void> {
  const key = uuidToLockKey(sessionId);
  try {
    await query('SELECT pg_advisory_unlock($1)', [key]);
  } catch (error) {
    // Log but never throw — lock release is best-effort cleanup
    console.error('[database] Failed to release session lock:', (error as Error).message);
  }
}
