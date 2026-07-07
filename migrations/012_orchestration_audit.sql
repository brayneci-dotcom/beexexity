-- Migration 012: Orchestration Audit Columns
-- Description: Add grouping columns for per-step sequential reasoning audit records.

BEGIN;

ALTER TABLE audit_logs
  ADD COLUMN orchestration_group_id UUID;

ALTER TABLE audit_logs
  ADD COLUMN orchestration_step_order INTEGER;

COMMENT ON COLUMN audit_logs.orchestration_group_id IS
  'Groups child audit rows from one sequential reasoning execution. Parent row shares same UUID.';

COMMENT ON COLUMN audit_logs.orchestration_step_order IS
  '0 = planner call, 1-N = execution steps. NULL for non-orchestrated requests.';

CREATE INDEX idx_audit_logs_orch_group ON audit_logs(orchestration_group_id)
  WHERE orchestration_group_id IS NOT NULL;

COMMIT;
