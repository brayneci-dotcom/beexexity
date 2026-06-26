-- Migration: 003_gateway_enhancements.sql
-- Description: Add force password reset flag to users and routing metadata to audit_logs

-- 1. Add force_password_reset flag to users table
ALTER TABLE users ADD COLUMN force_password_reset BOOLEAN NOT NULL DEFAULT TRUE;

-- Set existing users to false (they don't need forced reset)
UPDATE users SET force_password_reset = FALSE WHERE force_password_reset = TRUE;

-- 2. Add routing metadata columns to audit_logs
ALTER TABLE audit_logs ADD COLUMN routing_state VARCHAR(16);
ALTER TABLE audit_logs ADD COLUMN complexity_score INTEGER;
ALTER TABLE audit_logs ADD COLUMN routing_reason_code VARCHAR(64);
ALTER TABLE audit_logs ADD COLUMN reasoning_summary TEXT;
ALTER TABLE audit_logs ADD COLUMN executed_model_id VARCHAR(128);
ALTER TABLE audit_logs ADD COLUMN manual_override_applied BOOLEAN DEFAULT FALSE;
ALTER TABLE audit_logs ADD COLUMN modality_flags JSONB;
ALTER TABLE audit_logs ADD COLUMN routing_flags TEXT[];

-- 3. Indexes for routing analysis queries
CREATE INDEX idx_audit_logs_routing_state ON audit_logs(routing_state);
CREATE INDEX idx_audit_logs_complexity_score ON audit_logs(complexity_score);
