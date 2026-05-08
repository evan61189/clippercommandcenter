-- Migration: Add Procore vs QBO comparison totals for closeout
-- Phase 1: Summary totals for subcontractors, retention, and labor

-- Subcontractor invoiced totals
ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS procore_sub_invoiced DECIMAL(15,2) DEFAULT 0;
ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS qbo_sub_invoiced DECIMAL(15,2) DEFAULT 0;

-- Subcontractor paid totals
ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS procore_sub_paid DECIMAL(15,2) DEFAULT 0;
ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS qbo_sub_paid DECIMAL(15,2) DEFAULT 0;

-- Retention breakdown (Procore retention_held already exists as sub_retention_held)
ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS procore_retention_held DECIMAL(15,2) DEFAULT 0;
ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS qbo_retention_held DECIMAL(15,2) DEFAULT 0;

-- Retention paid
ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS procore_retention_paid DECIMAL(15,2) DEFAULT 0;
ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS qbo_retention_paid DECIMAL(15,2) DEFAULT 0;

-- Labor totals
ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS procore_labor DECIMAL(15,2) DEFAULT 0;
ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS qbo_labor DECIMAL(15,2) DEFAULT 0;

-- Add index for faster queries on new columns
CREATE INDEX IF NOT EXISTS idx_reports_procore_sub_invoiced ON reconciliation_reports(procore_sub_invoiced);
CREATE INDEX IF NOT EXISTS idx_reports_qbo_sub_invoiced ON reconciliation_reports(qbo_sub_invoiced);
