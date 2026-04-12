-- Migration: Add separated retainage released and retainage paid columns to reconciliation_reports
-- The legacy procore_retention_paid / qbo_retention_paid columns stored "released" values.
-- These new columns properly separate released (billed for) vs paid (disbursed).

ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS procore_retainage_released DECIMAL(15,2) DEFAULT 0;
ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS qbo_retainage_released DECIMAL(15,2) DEFAULT 0;
ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS procore_retainage_paid DECIMAL(15,2) DEFAULT 0;
ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS qbo_retainage_paid DECIMAL(15,2) DEFAULT 0;
