-- Migration 014: Feedback Reports
-- Description: Stores user feedback reports with LLM-generated root cause analysis.

BEGIN;

CREATE TABLE IF NOT EXISTS feedback_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,

    -- Input dari User
    user_feedback TEXT NOT NULL,
    error_category VARCHAR(50) NOT NULL,

    -- Final response text (dari frontend, apa yang user lihat)
    final_response TEXT NOT NULL,

    -- Routing metadata (di-extract dari audit_logs oleh backend)
    routing_metadata JSONB,

    -- Verification results (disimpan dari SSE — tidak ada di tabel lain)
    verification_results JSONB,

    -- Hasil Sintesis LLM (qwen3-235b)
    alignment_summary TEXT,
    root_cause_analysis TEXT,
    recommendation TEXT,

    -- Status & Admin
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_reports_session ON feedback_reports(session_id);
CREATE INDEX IF NOT EXISTS idx_feedback_reports_status ON feedback_reports(status);
CREATE INDEX IF NOT EXISTS idx_feedback_reports_category ON feedback_reports(error_category);

COMMIT;
