-- Migration: 007_session_memory.sql
-- Description: Add rolling summary and memory tracking columns to sessions table.

ALTER TABLE sessions
  ADD COLUMN rolling_summary TEXT,
  ADD COLUMN memory_version INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN sessions.rolling_summary IS
  'Compact summary of older conversation turns beyond the raw window. Updated when context truncation occurs.';

COMMENT ON COLUMN sessions.memory_version IS
  'Incremented each time the summary is refreshed. Used for debugging and cache invalidation.';
