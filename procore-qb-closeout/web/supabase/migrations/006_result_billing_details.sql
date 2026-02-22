-- Add billing breakdown and retention released fields to reconciliation_results
ALTER TABLE reconciliation_results
  ADD COLUMN IF NOT EXISTS retainage_released DECIMAL(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS work_completed_this_period DECIMAL(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS work_completed_previous DECIMAL(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS materials_stored DECIMAL(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_completed_and_stored DECIMAL(15,2) DEFAULT 0;
