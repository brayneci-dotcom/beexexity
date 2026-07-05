-- Migration 010: Add orchestration_meta column to audit_logs
-- Stores sub-agent orchestration metadata (plan, results, timing)

ALTER TABLE audit_logs
  ADD COLUMN orchestration_meta JSONB;

COMMENT ON COLUMN audit_logs.orchestration_meta IS
  'Sub-agent orchestration metadata: specs, results, timing breakdown, summarization flags';

-- Backfill existing rows with null (safe no-op)
