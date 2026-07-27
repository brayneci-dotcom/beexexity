-- Migration: 020_add_passthrough_flag
-- Adds passthrough mode flag to audit_logs for filtering requests that bypass routing.

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS passthrough BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN audit_logs.passthrough IS
  'True when the request was processed in passthrough mode (no routing/refinement).';
