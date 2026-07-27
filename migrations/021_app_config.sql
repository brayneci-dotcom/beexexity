-- Migration: 021_app_config
-- Creates app_config table for global application settings (admin-toggleable flags).

CREATE TABLE IF NOT EXISTS app_config (
  key   VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL
);

-- Seed default passthrough_mode = false
INSERT INTO app_config (key, value)
  VALUES ('passthrough_mode', 'false')
  ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE app_config IS
  'Key-value configuration store for admin-toggleable global settings.';
COMMENT ON COLUMN app_config.key IS
  'Configuration key, e.g. passthrough_mode';
COMMENT ON COLUMN app_config.value IS
  'JSON-encoded value. For booleans: "true" or "false" (JSONB).';
