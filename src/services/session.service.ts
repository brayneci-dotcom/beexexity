import { query } from '../config/database.js';
import { config } from '../config/index.js';
import type { Session, StoredMessage, StorageFlags } from '../types/session.types.js';

/**
 * Session Service — manages conversation session lifecycle and message CRUD.
 * Sessions are scoped to authenticated users and expire after a configurable period.
 * Expired sessions are detected at read time; no background sweep required.
 *
 * @see Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.4, 2.5, 2.6
 */

/**
 * Thrown when a session has passed its expires_at time.
 */
export class SessionExpiredError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} has expired`);
    this.name = 'SessionExpiredError';
  }
}

/**
 * Thrown when a session is not found or does not belong to the requesting user.
 */
export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} not found`);
    this.name = 'SessionNotFoundError';
  }
}

/**
 * Database row shape for sessions table.
 */
interface SessionRow {
  id: string;
  user_id: string;
  status: 'active' | 'degraded' | 'inactive' | 'expired';
  turn_count: number;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  expires_at: string;
}

/**
 * Database row shape for messages table.
 */
interface MessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  sanitized_content: string;
  created_at: string;
  storage_flags: StorageFlags;
}

/**
 * Map a database row to the Session domain type.
 */
function mapSessionRow(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    turnCount: row.turn_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Map a database row to the StoredMessage domain type.
 */
function mapMessageRow(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    sanitizedContent: row.sanitized_content,
    createdAt: row.created_at,
    storageFlags: row.storage_flags,
  };
}

/**
 * Check whether a session has expired by comparing expires_at with the current time.
 */
export function isSessionExpired(session: Session): boolean {
  return new Date(session.expiresAt) <= new Date();
}

/**
 * Update last_activity_at and updated_at for a session.
 * Called after each message append to keep the session's activity timestamp fresh.
 */
export async function touchSession(sessionId: string): Promise<void> {
  await query(
    `UPDATE sessions SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [sessionId],
  );
}

/**
 * Retrieve or create a session for the given user.
 *
 * If sessionId is provided and refers to an active, non-expired session owned
 * by the user, that session is returned. Otherwise a new active session is created
 * with expiresAt = now + config.session.expiryHours.
 *
 * Invalid, expired, or foreign sessionIds are silently ignored and a new session
 * is created instead — this follows the design's graceful-degradation principle.
 */
export async function getOrCreateSession(userId: string, sessionId?: string): Promise<Session> {
  // Attempt to retrieve the provided session if an ID was given
  if (sessionId) {
    const result = await query<SessionRow>(
      `SELECT id, user_id, status, turn_count, created_at, updated_at, last_activity_at, expires_at
       FROM sessions WHERE id = $1`,
      [sessionId],
    );

    const row = result.rows[0];
    if (row) {
      const session = mapSessionRow(row);

      // Validate ownership, active status, and expiry
      if (session.userId === userId && session.status === 'active' && !isSessionExpired(session)) {
        return session;
      }
    }
  }

  // Create a new session with expiry = now + expiryHours
  const expiryHours = config.session.expiryHours;
  const createResult = await query<SessionRow>(
    `INSERT INTO sessions (user_id, status, expires_at)
     VALUES ($1, 'active', NOW() + INTERVAL '1 hour' * $2)
     RETURNING id, user_id, status, turn_count, created_at, updated_at, last_activity_at, expires_at`,
    [userId, expiryHours],
  );

  return mapSessionRow(createResult.rows[0]);
}

/**
 * Get the most recent active session for a user.
 * Returns null if no active (non-expired) session exists.
 */
export async function getActiveSession(userId: string): Promise<Session | null> {
  const result = await query<SessionRow>(
    `SELECT id, user_id, status, turn_count, created_at, updated_at, last_activity_at, expires_at
     FROM sessions
     WHERE user_id = $1 AND status = 'active'
     ORDER BY last_activity_at DESC
     LIMIT 1`,
    [userId],
  );

  const row = result.rows[0];
  if (!row) return null;

  const session = mapSessionRow(row);

  // Check expiry at read time
  if (isSessionExpired(session)) {
    return null;
  }

  return session;
}

/**
 * Retrieve messages for a session ordered by created_at ASC, tie-broken by id ASC.
 * Optionally limits the number of messages returned.
 */
export async function getSessionMessages(sessionId: string, limit?: number): Promise<StoredMessage[]> {
  let sql = `SELECT id, session_id, role, sanitized_content, created_at, storage_flags
             FROM messages
             WHERE session_id = $1
             ORDER BY created_at ASC, id ASC`;
  const params: unknown[] = [sessionId];

  if (limit !== undefined && limit > 0) {
    sql += ` LIMIT $2`;
    params.push(limit);
  }

  const result = await query<MessageRow>(sql, params);
  return result.rows.map(mapMessageRow);
}

/**
 * Store a new message in the session and touch the session's activity timestamp.
 * Returns the stored message record.
 *
 * If persistence fails, the error is propagated so the caller can handle it
 * according to the graceful-degradation policy (log and flag session as partially persisted).
 */
export async function storeMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  flags: StorageFlags,
): Promise<StoredMessage> {
  const result = await query<MessageRow>(
    `INSERT INTO messages (session_id, role, sanitized_content, storage_flags)
     VALUES ($1, $2, $3, $4)
     RETURNING id, session_id, role, sanitized_content, created_at, storage_flags`,
    [sessionId, role, content, JSON.stringify(flags)],
  );

  // Update session activity timestamps
  await touchSession(sessionId);

  return mapMessageRow(result.rows[0]);
}

/**
 * Transition a session to 'degraded' state.
 * Called when assistant message persistence fails.
 * This operation is idempotent — no error if the session is already degraded.
 *
 * @see Requirements 1.3, 1.4
 */
export async function transitionToDegraded(sessionId: string): Promise<void> {
  await query(
    `UPDATE sessions SET status = 'degraded', updated_at = NOW() WHERE id = $1`,
    [sessionId],
  );
}

/**
 * Increment the turn_count for a session after a complete turn.
 * Called only after both user and assistant messages are successfully persisted.
 */
export async function incrementTurnCount(sessionId: string): Promise<void> {
  await query(
    `UPDATE sessions SET turn_count = turn_count + 1, updated_at = NOW() WHERE id = $1`,
    [sessionId],
  );
}

/**
 * Mark a session as inactive. Used when the user explicitly starts a new chat
 * or when the reset endpoint is called.
 * This operation is idempotent — calling it on an already-inactive session is safe.
 */
export async function markSessionInactive(sessionId: string): Promise<void> {
  await query(
    `UPDATE sessions SET status = 'inactive', updated_at = NOW() WHERE id = $1`,
    [sessionId],
  );
}

/**
 * Get session with state validation — rejects expired sessions.
 * Returns the session or throws SessionExpiredError / SessionNotFoundError.
 *
 * If no sessionId is provided, delegates to getOrCreateSession (which always
 * returns a valid active session).
 *
 * If sessionId is provided:
 * - Fetches the session from DB
 * - Throws SessionNotFoundError if the session doesn't exist or belongs to a different user
 * - Throws SessionExpiredError if expires_at is in the past
 * - Allows both 'active' and 'degraded' sessions to proceed
 *
 * @see Requirements 1.6, 2.1
 */
export async function getValidatedSession(
  userId: string,
  sessionId?: string,
): Promise<Session> {
  // No sessionId provided — delegate to existing getOrCreateSession
  if (!sessionId) {
    return getOrCreateSession(userId);
  }

  // Fetch the session by ID
  const result = await query<SessionRow>(
    `SELECT id, user_id, status, turn_count, created_at, updated_at, last_activity_at, expires_at
     FROM sessions WHERE id = $1`,
    [sessionId],
  );

  const row = result.rows[0];

  // Not found or belongs to a different user → SessionNotFoundError
  if (!row || row.user_id !== userId) {
    throw new SessionNotFoundError(sessionId);
  }

  const session = mapSessionRow(row);

  // Check expiry — reject if expires_at is in the past
  if (isSessionExpired(session)) {
    throw new SessionExpiredError(sessionId);
  }

  // Allow both 'active' and 'degraded' sessions to proceed
  return session;
}
