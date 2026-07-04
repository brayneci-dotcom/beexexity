-- Migration: 009_add_group_name.sql
-- Description: Add group_name column to users table for organizational grouping.

ALTER TABLE users
  ADD COLUMN group_name VARCHAR(255);

COMMENT ON COLUMN users.group_name IS
  'Organizational group or department the user belongs to, e.g. "IT Business Enablement"';
