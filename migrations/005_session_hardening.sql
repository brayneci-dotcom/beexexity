-- Migration: 005_session_hardening.sql
-- Description: Add 'degraded' session state, turn_count to sessions,
--              and session_state/turn_count to audit_logs for observability.

-- Wrap in transaction to prevent leaving the table without a constraint
-- if the ADD CONSTRAINT fails after the DROP.
BEGIN;

-- Add 'degraded' to session status CHECK constraint
ALTER TABLE sessions DROP CONSTRAINT sessions_status_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_status_check
  CHECK (status IN ('active', 'degraded', 'inactive', 'expired'));

-- Add turn_count column to sessions
ALTER TABLE sessions ADD COLUMN turn_count INTEGER NOT NULL DEFAULT 0;

COMMIT;

-- Add session_state and turn_count columns to audit_logs for observability
ALTER TABLE audit_logs ADD COLUMN session_state VARCHAR(16);
ALTER TABLE audit_logs ADD COLUMN turn_count INTEGER;
