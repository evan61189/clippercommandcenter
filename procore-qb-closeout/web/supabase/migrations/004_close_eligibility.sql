-- Migration: Add soft/hard close eligibility flags and soft_closed_projects table

-- Close eligibility flags on reconciliation_reports
ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS soft_close_eligible BOOLEAN DEFAULT FALSE;
ALTER TABLE reconciliation_reports ADD COLUMN IF NOT EXISTS hard_close_eligible BOOLEAN DEFAULT FALSE;

-- Soft closed projects table (tracks which projects have been soft closed)
CREATE TABLE IF NOT EXISTS soft_closed_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    soft_closed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    soft_closed_by TEXT,
    notes TEXT,
    open_aps INTEGER DEFAULT 0,
    open_ars INTEGER DEFAULT 0,
    pending_invoices INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(project_id)
);

CREATE INDEX IF NOT EXISTS idx_soft_closed_project ON soft_closed_projects(project_id);

-- RLS policies (match existing pattern)
ALTER TABLE soft_closed_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all soft closed projects" ON soft_closed_projects FOR SELECT USING (true);
CREATE POLICY "Users can insert soft closed projects" ON soft_closed_projects FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can delete soft closed projects" ON soft_closed_projects FOR DELETE USING (true);
