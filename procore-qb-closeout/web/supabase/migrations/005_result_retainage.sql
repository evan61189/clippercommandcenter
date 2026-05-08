-- Migration: Add per-result retainage tracking on reconciliation_results
ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS procore_retainage DECIMAL(15,2) DEFAULT 0;
ALTER TABLE reconciliation_results ADD COLUMN IF NOT EXISTS qb_retainage DECIMAL(15,2) DEFAULT 0;
