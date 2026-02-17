-- Migration: Add soft/hard close eligibility flags to reconciliation reports

ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS soft_close_eligible BOOLEAN DEFAULT FALSE;
ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS hard_close_eligible BOOLEAN DEFAULT FALSE;
