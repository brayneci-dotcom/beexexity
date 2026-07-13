-- 015_update_skill_taxonomy.sql
-- Data migration: rename old skill names in routing_metadata JSONB.
-- skill is stored inside JSONB, not a dedicated column — CHECK constraints don't apply.
-- 'general' → 'fallback' (legacy catch-all renamed)
-- 'document_qna' → 'fallback' (document_analysis skill removed)

UPDATE feedback_reports
SET routing_metadata = routing_metadata || jsonb_build_object('skill', 'fallback')
WHERE routing_metadata->>'skill' IN ('general', 'document_qna');

-- Drop obsolete index for removed skills (if it exists)
DROP INDEX IF EXISTS idx_audit_logs_skill_new;
