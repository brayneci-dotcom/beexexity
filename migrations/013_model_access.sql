-- Migration 013: Model Access Control
-- Description: Whitelist table for private model access by username.

BEGIN;

CREATE TABLE IF NOT EXISTS user_model_access (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_id VARCHAR(128) NOT NULL,
    username VARCHAR(64) NOT NULL,          -- Denormalized for admin display
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_user_model_access_user ON user_model_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_model_access_model ON user_model_access(model_id);

COMMIT;
