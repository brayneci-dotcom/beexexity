-- 017_add_routing_context.sql
-- Store contract.context and contract.intent from routing decision
-- for session row preview and admin analysis.

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS routing_context TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS routing_intent TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_logs_routing_context
  ON audit_logs(routing_context)
  WHERE routing_context IS NOT NULL;
