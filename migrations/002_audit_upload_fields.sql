-- Migration: Add multimodal upload metadata columns to audit_logs
ALTER TABLE audit_logs ADD COLUMN file_count INTEGER;
ALTER TABLE audit_logs ADD COLUMN file_mime_types TEXT[];
ALTER TABLE audit_logs ADD COLUMN total_file_size INTEGER;
ALTER TABLE audit_logs ADD COLUMN is_multimodal BOOLEAN DEFAULT FALSE;
