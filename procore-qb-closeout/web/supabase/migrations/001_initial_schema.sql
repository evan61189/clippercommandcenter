-- Procore-QuickBooks Closeout Reconciliation Database Schema
-- This schema stores reconciliation data for viewing in the web dashboard

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Projects table
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    procore_id INTEGER UNIQUE,
    name VARCHAR(255) NOT NULL,
    project_number VARCHAR(50),
    address TEXT,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Reconciliation reports table (one per closeout run)
CREATE TABLE reconciliation_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Summary metrics
    total_contract_value DECIMAL(15,2),
    total_committed DECIMAL(15,2),
    total_billed_by_subs DECIMAL(15,2),
    total_paid_to_subs DECIMAL(15,2),
    sub_retention_held DECIMAL(15,2),

    -- Reconciliation counts
    reconciled_items INTEGER DEFAULT 0,
    warning_items INTEGER DEFAULT 0,
    critical_items INTEGER DEFAULT 0,
    open_closeout_items INTEGER DEFAULT 0,
    estimated_exposure DECIMAL(15,2) DEFAULT 0,

    -- AI-generated content
    executive_summary TEXT,
    ai_analysis JSONB,

    -- Status
    status VARCHAR(50) DEFAULT 'complete',

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Reconciliation results (individual comparisons)
CREATE TABLE reconciliation_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID REFERENCES reconciliation_reports(id) ON DELETE CASCADE,

    result_id VARCHAR(50), -- Original ID from reconciler
    item_type VARCHAR(50) NOT NULL, -- commitment, invoice, change_order, retention, budget
    item_description TEXT,
    vendor VARCHAR(255),

    procore_value DECIMAL(15,2),
    qb_value DECIMAL(15,2),
    variance DECIMAL(15,2),
    variance_pct DECIMAL(10,2),

    severity VARCHAR(20) DEFAULT 'info', -- info, warning, critical
    notes TEXT,
    procore_ref VARCHAR(100),
    qb_ref VARCHAR(100),
    cost_code VARCHAR(50),
    requires_action BOOLEAN DEFAULT FALSE,

    -- AI analysis for this item
    ai_likely_cause TEXT,
    ai_risk_level VARCHAR(20),
    ai_recommended_action TEXT,
    ai_is_timing_issue BOOLEAN,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Closeout items (action items)
CREATE TABLE closeout_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID REFERENCES reconciliation_reports(id) ON DELETE CASCADE,

    item_id VARCHAR(50),
    category VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'open', -- open, in_progress, resolved
    responsible_party VARCHAR(255),
    vendor VARCHAR(255),
    amount_at_risk DECIMAL(15,2) DEFAULT 0,
    action_required TEXT,
    due_date DATE,
    priority INTEGER DEFAULT 3,

    -- Resolution tracking
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by VARCHAR(255),
    resolution_notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Commitments (for detailed view)
CREATE TABLE commitments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID REFERENCES reconciliation_reports(id) ON DELETE CASCADE,

    vendor VARCHAR(255) NOT NULL,
    procore_id VARCHAR(100),
    qb_id VARCHAR(100),
    commitment_type VARCHAR(50), -- subcontract, purchase_order
    title TEXT,
    status VARCHAR(50),

    original_amount DECIMAL(15,2),
    approved_changes DECIMAL(15,2),
    pending_changes DECIMAL(15,2),
    current_value DECIMAL(15,2),
    billed_to_date DECIMAL(15,2),
    paid_to_date DECIMAL(15,2),
    retention_held DECIMAL(15,2),
    balance_remaining DECIMAL(15,2),

    cost_codes TEXT[], -- Array of cost codes

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Cost code mappings
CREATE TABLE cost_code_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,

    procore_cost_code VARCHAR(50) NOT NULL,
    procore_description VARCHAR(255),
    csi_division VARCHAR(10),
    qb_account_id VARCHAR(50),
    qb_account_name VARCHAR(255),
    confidence DECIMAL(5,4),
    manually_verified BOOLEAN DEFAULT FALSE,
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(project_id, procore_cost_code)
);

-- Indexes for common queries
CREATE INDEX idx_reports_project ON reconciliation_reports(project_id);
CREATE INDEX idx_reports_generated ON reconciliation_reports(generated_at DESC);
CREATE INDEX idx_results_report ON reconciliation_results(report_id);
CREATE INDEX idx_results_severity ON reconciliation_results(severity);
CREATE INDEX idx_results_type ON reconciliation_results(item_type);
CREATE INDEX idx_closeout_report ON closeout_items(report_id);
CREATE INDEX idx_closeout_status ON closeout_items(status);
CREATE INDEX idx_closeout_priority ON closeout_items(priority);
CREATE INDEX idx_commitments_report ON commitments(report_id);
CREATE INDEX idx_mappings_project ON cost_code_mappings(project_id);

-- Row Level Security (RLS)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE closeout_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_code_mappings ENABLE ROW LEVEL SECURITY;

-- Policies (for authenticated users - adjust as needed)
CREATE POLICY "Users can view all projects" ON projects FOR SELECT USING (true);
CREATE POLICY "Users can view all reports" ON reconciliation_reports FOR SELECT USING (true);
CREATE POLICY "Users can view all results" ON reconciliation_results FOR SELECT USING (true);
CREATE POLICY "Users can view all closeout items" ON closeout_items FOR SELECT USING (true);
CREATE POLICY "Users can view all commitments" ON commitments FOR SELECT USING (true);
CREATE POLICY "Users can view all mappings" ON cost_code_mappings FOR SELECT USING (true);

-- Insert policies
CREATE POLICY "Users can insert projects" ON projects FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can insert reports" ON reconciliation_reports FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can insert results" ON reconciliation_results FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can insert closeout items" ON closeout_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can insert commitments" ON commitments FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can insert mappings" ON cost_code_mappings FOR INSERT WITH CHECK (true);

-- Update policies for closeout items (to mark as resolved)
CREATE POLICY "Users can update closeout items" ON closeout_items FOR UPDATE USING (true);
CREATE POLICY "Users can update mappings" ON cost_code_mappings FOR UPDATE USING (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_closeout_items_updated_at
    BEFORE UPDATE ON closeout_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cost_code_mappings_updated_at
    BEFORE UPDATE ON cost_code_mappings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
