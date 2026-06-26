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
