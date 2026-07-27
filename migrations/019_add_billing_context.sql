-- Migration: 019_add_billing_context
-- Adds billing context columns for per-organizer cost attribution (bssmom integration).
-- Separates billed user from the authenticated service account (ghostmeet).

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS billed_user_id  UUID,
  ADD COLUMN IF NOT EXISTS billed_group    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS api_key_used    BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN audit_logs.billed_user_id IS
  'Organizer user UUID for cost attribution (may differ from authenticated service account). NULL for interactive chat sessions.';
COMMENT ON COLUMN audit_logs.billed_group IS
  'Organizational group of the billed user for cost rollup reports.';
COMMENT ON COLUMN audit_logs.api_key_used IS
  'True if this request was authenticated via X-API-Key (machine-to-machine) rather than JWT.';

CREATE INDEX IF NOT EXISTS idx_audit_logs_billed_user ON audit_logs(billed_user_id) WHERE billed_user_id IS NOT NULL;
