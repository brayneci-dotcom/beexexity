-- Migration 016: Discovered Roles
-- Stores novel roles from fallback refinement in PostgreSQL instead of flat files.
-- Durable across Cloud Run instances, shared across all instances.

CREATE TABLE IF NOT EXISTS discovered_roles (
    role TEXT PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'accepted', 'rejected', 'deployed')),
    count INTEGER NOT NULL DEFAULT 1,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sample_context TEXT,
    sample_intent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovered_roles_status ON discovered_roles(status);
