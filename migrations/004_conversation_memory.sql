-- Migration: 004_conversation_memory.sql
-- Description: Add sessions and messages tables for conversation memory,
--              plus audit_logs columns for session-aware observability.

-- 1. Sessions table
CREATE TABLE sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    status          VARCHAR(16) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive', 'expired')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_sessions_user_active ON sessions(user_id, status)
    WHERE status = 'active';
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- 2. Messages table
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role            VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant')),
    sanitized_content TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    storage_flags   JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_messages_session_order ON messages(session_id, created_at ASC, id ASC);

-- 3. Audit log additions for session-aware observability
ALTER TABLE audit_logs ADD COLUMN session_id UUID;
ALTER TABLE audit_logs ADD COLUMN replayed_message_count INTEGER;
ALTER TABLE audit_logs ADD COLUMN context_truncated BOOLEAN DEFAULT FALSE;
ALTER TABLE audit_logs ADD COLUMN context_summarized BOOLEAN DEFAULT FALSE;
