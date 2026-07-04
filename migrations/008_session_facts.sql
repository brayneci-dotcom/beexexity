-- Migration: 008_session_facts.sql
-- Description: Add extracted_facts JSONB column for structured fact extraction (tier 3 memory).

ALTER TABLE sessions
  ADD COLUMN extracted_facts JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN sessions.extracted_facts IS
  'Structured key-value facts extracted from conversation: { "budget": "50M Q3", "deadline": "Sep 30" }. Updated each turn.';
