-- Migration: 006_audit_pricing_snapshot.sql
-- Description: Add model pricing snapshot column to audit_logs for historical cost accuracy.

-- 1. Add model_pricing_snapshot column
ALTER TABLE audit_logs
  ADD COLUMN model_pricing_snapshot JSONB;

COMMENT ON COLUMN audit_logs.model_pricing_snapshot IS
  'Model pricing at request time: { inputPricePer1MTokens, outputPricePer1MTokens }. NULL for failed requests or pre-migration rows.';

-- 2. Index for efficient per-session stats queries
CREATE INDEX idx_audit_logs_session_id ON audit_logs(session_id)
  WHERE status = 'success';
