-- 018_add_session_context.sql
-- Store classifier reasoning for session row preview.

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS session_context TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_logs_session_context
  ON audit_logs(session_context)
  WHERE session_context IS NOT NULL;
