-- Migration 011: Google OAuth authentication support
-- Adds google_id and auth_provider columns, makes password nullable

-- Make password column nullable for Google-only users
ALTER TABLE users ALTER COLUMN password DROP NOT NULL;

-- Add Google OIDC subject identifier (unique, indexed)
ALTER TABLE users ADD COLUMN google_id VARCHAR(255) UNIQUE;

-- Add auth provider discriminator: 'local' | 'google'
ALTER TABLE users ADD COLUMN auth_provider VARCHAR(16) NOT NULL DEFAULT 'local';

-- Add check constraint for valid auth_provider values
ALTER TABLE users ADD CONSTRAINT users_auth_provider_check
  CHECK (auth_provider IN ('local', 'google'));

-- Index for google_id lookups (partial index — only non-null rows)
CREATE INDEX idx_users_google_id ON users (google_id) WHERE google_id IS NOT NULL;

COMMENT ON COLUMN users.password IS 'Can be NULL for Google-authenticated users (auth_provider = ''google'')';
COMMENT ON COLUMN users.google_id IS 'Google OIDC sub claim — used for OAuth login lookup';
COMMENT ON COLUMN users.auth_provider IS 'Authentication method: ''local'' (password) or ''google'' (OAuth)';
