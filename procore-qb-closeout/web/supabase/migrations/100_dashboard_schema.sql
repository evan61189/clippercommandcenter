-- ============================================================
-- Clipper Command Terminal — Executive Dashboard Schema
-- Migration 100: Full dashboard schema (new Supabase project)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- CORE TABLES
-- ============================================================

CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    logo_url TEXT,
    address JSONB,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id UUID UNIQUE, -- links to Supabase Auth
    email VARCHAR(255) UNIQUE NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(50),
    role VARCHAR(50) DEFAULT 'member',
    avatar_url TEXT,
    status VARCHAR(20) DEFAULT 'active',
    preferences JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('owner','admin','project_manager','member','viewer')),
    title VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, organization_id)
);

-- ============================================================
-- PROJECTS
-- ============================================================

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50),
    description TEXT,
    type VARCHAR(50),
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('planning','pre_construction','active','completed','on_hold','closed')),
    address JSONB,
    start_date DATE,
    estimated_completion_date DATE,
    actual_completion_date DATE,
    original_contract_value NUMERIC(15,2),
    current_contract_value NUMERIC(15,2),
    gross_square_footage INTEGER,
    settings JSONB DEFAULT '{}',
    procore_project_id TEXT,
    qb_job_id TEXT,
    created_by_id UUID REFERENCES users(id),
    updated_by_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE project_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('project_manager','superintendent','engineer','coordinator','admin','viewer','client','architect','owner_rep','subcontractor')),
    permissions JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, user_id, role)
);

-- ============================================================
-- STAFF & RESOURCE MANAGEMENT
-- ============================================================

CREATE TABLE staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    role VARCHAR(50) NOT NULL CHECK (role IN ('project_manager','superintendent')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','on_leave','terminated')),
    max_capacity_slots INTEGER NOT NULL DEFAULT 2,
    hire_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE staff_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID REFERENCES staff(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    role_on_project VARCHAR(50) NOT NULL CHECK (role_on_project IN ('project_manager','superintendent','assistant_pm')),
    slots_consumed INTEGER DEFAULT 1,
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN DEFAULT TRUE,
    allocation_percent INTEGER DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE capacity_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR(50) NOT NULL,
    max_slots INTEGER NOT NULL,
    large_job_threshold NUMERIC(15,2) DEFAULT 600000,
    large_job_slots INTEGER DEFAULT 2,
    small_job_slots INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PROJECT MANAGEMENT
-- ============================================================

CREATE TABLE rfis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    number VARCHAR(50),
    subject TEXT,
    question TEXT,
    status VARCHAR(50) DEFAULT 'open',
    priority VARCHAR(20) DEFAULT 'normal',
    assigned_to_id UUID REFERENCES users(id),
    due_date DATE,
    answer TEXT,
    responded_at TIMESTAMPTZ,
    cost_impact NUMERIC(15,2),
    schedule_impact INTEGER, -- days
    spec_section VARCHAR(100),
    drawing_ids TEXT[],
    attachments JSONB,
    procore_id TEXT,
    created_by_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE change_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    number VARCHAR(50),
    title VARCHAR(255),
    description TEXT,
    status VARCHAR(50) DEFAULT 'identified',
    source VARCHAR(50),
    event_type VARCHAR(50),
    estimated_cost NUMERIC(15,2),
    approved_cost NUMERIC(15,2),
    schedule_impact_days INTEGER,
    linked_rfi_id UUID REFERENCES rfis(id),
    cost_code VARCHAR(50),
    attachments JSONB,
    procore_id TEXT,
    created_by_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE submittals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    number VARCHAR(50),
    title VARCHAR(255),
    type VARCHAR(50),
    spec_section VARCHAR(100),
    status VARCHAR(50) DEFAULT 'pending',
    priority VARCHAR(20) DEFAULT 'normal',
    due_date DATE,
    required_on_site_date DATE,
    lead_time_days INTEGER,
    submitted_by_id UUID REFERENCES users(id),
    assigned_to_id UUID REFERENCES users(id),
    ball_in_court_id UUID REFERENCES users(id),
    attachments JSONB,
    procore_id TEXT,
    created_by_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE daily_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    weather JSONB,
    work_summary TEXT,
    manpower JSONB,
    total_workers INTEGER DEFAULT 0,
    total_hours NUMERIC(8,2) DEFAULT 0,
    materials_delivered JSONB,
    issues JSONB,
    safety_observations TEXT[],
    incidents_reported BOOLEAN DEFAULT FALSE,
    photos JSONB,
    status VARCHAR(20) DEFAULT 'draft',
    procore_id TEXT,
    created_by_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE punch_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    number VARCHAR(50),
    name VARCHAR(255),
    description TEXT,
    status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open','in_progress','ready_for_inspection','closed')),
    priority VARCHAR(20) DEFAULT 'normal',
    location VARCHAR(255),
    trade VARCHAR(100),
    assigned_to_name VARCHAR(255),
    due_date DATE,
    date_initiated DATE,
    date_closed DATE,
    photos JSONB,
    procore_id TEXT,
    created_by_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    number VARCHAR(50),
    name VARCHAR(255),
    description TEXT,
    observation_type VARCHAR(50),
    status VARCHAR(50) DEFAULT 'open',
    priority VARCHAR(20) DEFAULT 'normal',
    location VARCHAR(255),
    trade VARCHAR(100),
    hazard_category VARCHAR(100),
    date_observed DATE,
    date_resolved DATE,
    procore_id TEXT,
    created_by_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    number VARCHAR(50),
    name VARCHAR(255),
    inspection_type VARCHAR(50),
    status VARCHAR(50) DEFAULT 'pending',
    inspection_date DATE,
    due_date DATE,
    inspector_name VARCHAR(255),
    trade VARCHAR(100),
    pass_rate NUMERIC(5,2),
    deficiencies JSONB,
    procore_id TEXT,
    created_by_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FINANCIAL TABLES
-- ============================================================

CREATE TABLE subcontracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    number VARCHAR(50),
    title VARCHAR(255),
    vendor_name VARCHAR(255),
    status VARCHAR(50) DEFAULT 'draft',
    contract_value NUMERIC(15,2),
    trade VARCHAR(100),
    retainage_percent NUMERIC(5,2) DEFAULT 10,
    insurance_expiry DATE,
    executed BOOLEAN DEFAULT FALSE,
    signed_date DATE,
    payment_terms VARCHAR(100),
    scope_of_work TEXT,
    procore_id TEXT,
    created_by_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    number VARCHAR(50),
    invoice_type VARCHAR(50) CHECK (invoice_type IN ('pay_app','sub_invoice','po_invoice')),
    vendor_name VARCHAR(255),
    status VARCHAR(50) DEFAULT 'draft',
    billing_date DATE,
    period_start DATE,
    period_end DATE,
    scheduled_value NUMERIC(15,2),
    work_completed_previous NUMERIC(15,2),
    work_completed_this_period NUMERIC(15,2),
    materials_stored NUMERIC(15,2),
    total_completed_and_stored NUMERIC(15,2),
    retainage NUMERIC(15,2),
    total_earned_less_retainage NUMERIC(15,2),
    amount_due NUMERIC(15,2),
    is_final BOOLEAN DEFAULT FALSE,
    line_items JSONB,
    procore_id TEXT,
    created_by_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE prime_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    number VARCHAR(50),
    title VARCHAR(255),
    owner_name VARCHAR(255),
    status VARCHAR(50) DEFAULT 'draft',
    contract_value NUMERIC(15,2),
    retainage_percent NUMERIC(5,2) DEFAULT 10,
    executed BOOLEAN DEFAULT FALSE,
    procore_id TEXT,
    created_by_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    number VARCHAR(50),
    title VARCHAR(255),
    vendor_name VARCHAR(255),
    status VARCHAR(50) DEFAULT 'draft',
    po_value NUMERIC(15,2),
    delivery_date DATE,
    line_items JSONB,
    procore_id TEXT,
    created_by_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- QUICKBOOKS SYNC STAGING TABLES
-- ============================================================

CREATE TABLE qb_job_costs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    cost_code VARCHAR(50),
    description TEXT,
    vendor VARCHAR(255),
    amount NUMERIC(15,2),
    date DATE,
    category VARCHAR(50) CHECK (category IN ('labor','material','subcontract','equipment','other')),
    qb_txn_id TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE qb_ar_aging (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer VARCHAR(255),
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    current_amount NUMERIC(15,2) DEFAULT 0,
    days_30 NUMERIC(15,2) DEFAULT 0,
    days_60 NUMERIC(15,2) DEFAULT 0,
    days_90 NUMERIC(15,2) DEFAULT 0,
    over_90 NUMERIC(15,2) DEFAULT 0,
    total NUMERIC(15,2) DEFAULT 0,
    as_of DATE,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE qb_ap_aging (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor VARCHAR(255),
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    current_amount NUMERIC(15,2) DEFAULT 0,
    days_30 NUMERIC(15,2) DEFAULT 0,
    days_60 NUMERIC(15,2) DEFAULT 0,
    days_90 NUMERIC(15,2) DEFAULT 0,
    over_90 NUMERIC(15,2) DEFAULT 0,
    total NUMERIC(15,2) DEFAULT 0,
    as_of DATE,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE qb_bank_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_name VARCHAR(255),
    balance NUMERIC(15,2),
    as_of DATE,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE qb_profit_loss (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    revenue NUMERIC(15,2) DEFAULT 0,
    cost_of_revenue NUMERIC(15,2) DEFAULT 0,
    gross_profit NUMERIC(15,2) DEFAULT 0,
    overhead NUMERIC(15,2) DEFAULT 0,
    net_profit NUMERIC(15,2) DEFAULT 0,
    period_start DATE,
    period_end DATE,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE qb_cash_flow (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    month DATE,
    projected_receipts NUMERIC(15,2) DEFAULT 0,
    projected_disbursements NUMERIC(15,2) DEFAULT 0,
    net_cash_flow NUMERIC(15,2) DEFAULT 0,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PROCORE SYNC STAGING TABLES
-- ============================================================

CREATE TABLE procore_sync_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    entity_type VARCHAR(50),
    entity_id TEXT,
    direction VARCHAR(10) CHECK (direction IN ('push','pull')),
    status VARCHAR(50),
    error_message TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE procore_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    procore_project_id TEXT,
    procore_company_id TEXT,
    sync_enabled BOOLEAN DEFAULT TRUE,
    last_synced_at TIMESTAMPTZ
);

CREATE TABLE procore_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    procore_id TEXT,
    contract_type VARCHAR(20) CHECK (contract_type IN ('prime','sub','po')),
    vendor_name VARCHAR(255),
    original_value NUMERIC(15,2),
    approved_changes NUMERIC(15,2) DEFAULT 0,
    revised_value NUMERIC(15,2),
    billed_to_date NUMERIC(15,2) DEFAULT 0,
    retainage_held NUMERIC(15,2) DEFAULT 0,
    balance_to_finish NUMERIC(15,2),
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE procore_pay_apps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    procore_id TEXT,
    number TEXT,
    vendor_name VARCHAR(255),
    period_end DATE,
    scheduled_value NUMERIC(15,2),
    completed_previous NUMERIC(15,2),
    completed_this_period NUMERIC(15,2),
    stored_materials NUMERIC(15,2),
    total_completed NUMERIC(15,2),
    retainage NUMERIC(15,2),
    amount_due NUMERIC(15,2),
    status VARCHAR(50),
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE procore_budget (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    cost_code TEXT,
    description TEXT,
    original_budget NUMERIC(15,2),
    budget_changes NUMERIC(15,2) DEFAULT 0,
    revised_budget NUMERIC(15,2),
    committed NUMERIC(15,2) DEFAULT 0,
    actual_costs NUMERIC(15,2) DEFAULT 0,
    projected_cost NUMERIC(15,2),
    over_under NUMERIC(15,2),
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE procore_change_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    procore_id TEXT,
    number TEXT,
    title VARCHAR(255),
    status VARCHAR(50),
    amount NUMERIC(15,2),
    change_type VARCHAR(20) CHECK (change_type IN ('owner','sub','internal')),
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RECONCILIATION TABLES
-- ============================================================

CREATE TABLE reconciliation_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    snapshot_date DATE NOT NULL,
    -- Procore side
    procore_contract_value NUMERIC(15,2),
    procore_approved_changes NUMERIC(15,2),
    procore_revised_value NUMERIC(15,2),
    procore_billed NUMERIC(15,2),
    procore_costs NUMERIC(15,2),
    procore_committed NUMERIC(15,2),
    procore_retainage NUMERIC(15,2),
    -- QuickBooks side
    qb_contract_value NUMERIC(15,2),
    qb_approved_changes NUMERIC(15,2),
    qb_revised_value NUMERIC(15,2),
    qb_billed NUMERIC(15,2),
    qb_costs NUMERIC(15,2),
    qb_committed NUMERIC(15,2),
    qb_retainage NUMERIC(15,2),
    -- Calculated variances
    variance_contract NUMERIC(15,2),
    variance_changes NUMERIC(15,2),
    variance_billed NUMERIC(15,2),
    variance_costs NUMERIC(15,2),
    variance_committed NUMERIC(15,2),
    variance_retainage NUMERIC(15,2),
    -- Status
    match_status VARCHAR(50) CHECK (match_status IN ('matched','minor_variance','major_variance','unmatched')),
    reviewed_by_id UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE unmatched_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(20) CHECK (source IN ('procore','quickbooks')),
    external_id TEXT,
    project_name VARCHAR(255),
    contract_value NUMERIC(15,2),
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolved_by_id UUID REFERENCES users(id),
    notes TEXT
);

CREATE TABLE closeout_checklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    period_end DATE NOT NULL,
    contracts_reconciled BOOLEAN DEFAULT FALSE,
    change_orders_reconciled BOOLEAN DEFAULT FALSE,
    pay_apps_reconciled BOOLEAN DEFAULT FALSE,
    costs_reconciled BOOLEAN DEFAULT FALSE,
    retainage_reconciled BOOLEAN DEFAULT FALSE,
    ar_reconciled BOOLEAN DEFAULT FALSE,
    wip_reviewed BOOLEAN DEFAULT FALSE,
    completed_by_id UUID REFERENCES users(id),
    completed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, period_end)
);

-- ============================================================
-- DOCUMENTS & WORKFLOW
-- ============================================================

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    file_url TEXT,
    file_name VARCHAR(255),
    file_size INTEGER,
    mime_type VARCHAR(100),
    version INTEGER DEFAULT 1,
    tags TEXT[],
    is_public BOOLEAN DEFAULT FALSE,
    created_by_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE workflow_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    document_type VARCHAR(50),
    document_id UUID,
    from_status VARCHAR(50),
    to_status VARCHAR(50),
    changed_by_id UUID REFERENCES users(id),
    changed_by_name VARCHAR(255),
    reason TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- API CREDENTIALS (reused from FinancialCloseout)
-- ============================================================

CREATE TABLE api_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    provider VARCHAR(50) NOT NULL, -- 'procore', 'quickbooks'
    credentials JSONB NOT NULL,
    refresh_token TEXT,
    token_expiry TIMESTAMPTZ,
    company_id TEXT,
    realm_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_projects_org ON projects(organization_id);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_project_members_project ON project_members(project_id);
CREATE INDEX idx_project_members_user ON project_members(user_id);
CREATE INDEX idx_staff_role ON staff(role);
CREATE INDEX idx_staff_assignments_staff ON staff_assignments(staff_id);
CREATE INDEX idx_staff_assignments_project ON staff_assignments(project_id);
CREATE INDEX idx_staff_assignments_active ON staff_assignments(is_active);
CREATE INDEX idx_rfis_project ON rfis(project_id);
CREATE INDEX idx_rfis_status ON rfis(status);
CREATE INDEX idx_change_events_project ON change_events(project_id);
CREATE INDEX idx_submittals_project ON submittals(project_id);
CREATE INDEX idx_submittals_status ON submittals(status);
CREATE INDEX idx_daily_logs_project_date ON daily_logs(project_id, date DESC);
CREATE INDEX idx_punch_items_project ON punch_items(project_id);
CREATE INDEX idx_punch_items_status ON punch_items(status);
CREATE INDEX idx_subcontracts_project ON subcontracts(project_id);
CREATE INDEX idx_invoices_project ON invoices(project_id);
CREATE INDEX idx_qb_job_costs_project ON qb_job_costs(project_id);
CREATE INDEX idx_qb_ar_aging_project ON qb_ar_aging(project_id);
CREATE INDEX idx_qb_ap_aging_project ON qb_ap_aging(project_id);
CREATE INDEX idx_reconciliation_snapshots_project ON reconciliation_snapshots(project_id);
CREATE INDEX idx_reconciliation_snapshots_date ON reconciliation_snapshots(snapshot_date DESC);
CREATE INDEX idx_procore_contracts_project ON procore_contracts(project_id);
CREATE INDEX idx_procore_budget_project ON procore_budget(project_id);
CREATE INDEX idx_closeout_checklists_project ON closeout_checklists(project_id);

-- ============================================================
-- VIEWS
-- ============================================================

-- Staff utilization
CREATE OR REPLACE VIEW staff_utilization AS
SELECT
    s.id,
    s.first_name,
    s.last_name,
    s.email,
    s.role,
    s.max_capacity_slots,
    s.status,
    COALESCE(SUM(sa.slots_consumed) FILTER (WHERE sa.is_active = TRUE), 0) AS slots_used,
    s.max_capacity_slots - COALESCE(SUM(sa.slots_consumed) FILTER (WHERE sa.is_active = TRUE), 0) AS slots_available,
    ROUND(
        COALESCE(SUM(sa.slots_consumed) FILTER (WHERE sa.is_active = TRUE), 0)::NUMERIC
        / s.max_capacity_slots * 100
    ) AS utilization_percent,
    COUNT(sa.id) FILTER (WHERE sa.is_active = TRUE) AS active_project_count,
    ARRAY_AGG(DISTINCT p.name) FILTER (WHERE sa.is_active = TRUE) AS active_projects
FROM staff s
LEFT JOIN staff_assignments sa ON s.id = sa.staff_id
LEFT JOIN projects p ON sa.project_id = p.id
WHERE s.status = 'active'
GROUP BY s.id, s.first_name, s.last_name, s.email, s.role, s.max_capacity_slots, s.status;

-- Company capacity by role
CREATE OR REPLACE VIEW company_capacity AS
SELECT
    cr.role,
    cr.max_slots AS slots_per_person,
    COUNT(DISTINCT s.id) AS total_staff,
    SUM(s.max_capacity_slots) AS total_capacity,
    COALESCE(SUM(su.slots_used), 0) AS slots_used,
    SUM(s.max_capacity_slots) - COALESCE(SUM(su.slots_used), 0) AS slots_available,
    COUNT(DISTINCT s.id) FILTER (WHERE su.slots_used >= s.max_capacity_slots) AS fully_loaded_count,
    CASE
        WHEN SUM(s.max_capacity_slots) - COALESCE(SUM(su.slots_used), 0) <= 0 THEN 'HIRE_NOW'
        WHEN SUM(s.max_capacity_slots) - COALESCE(SUM(su.slots_used), 0) <= 1 THEN 'PLAN_HIRE'
        ELSE 'OK'
    END AS hiring_status
FROM capacity_rules cr
LEFT JOIN staff s ON s.role = cr.role AND s.status = 'active'
LEFT JOIN staff_utilization su ON s.id = su.id
GROUP BY cr.role, cr.max_slots;

-- WIP schedule
CREATE OR REPLACE VIEW wip_schedule AS
SELECT
    p.id AS project_id,
    p.code,
    p.name,
    p.status,
    p.original_contract_value,
    COALESCE(SUM(ce.approved_cost) FILTER (WHERE ce.status = 'approved'), 0) AS approved_changes,
    p.original_contract_value + COALESCE(SUM(ce.approved_cost) FILTER (WHERE ce.status = 'approved'), 0) AS revised_contract_value,
    COALESCE((SELECT SUM(amount) FROM qb_job_costs WHERE project_id = p.id), 0) AS costs_to_date,
    COALESCE((SELECT SUM(committed) - SUM(actual_costs) FROM procore_budget WHERE project_id = p.id), 0) AS est_cost_to_complete,
    COALESCE((SELECT SUM(amount) FROM qb_job_costs WHERE project_id = p.id), 0)
        + COALESCE((SELECT SUM(committed) - SUM(actual_costs) FROM procore_budget WHERE project_id = p.id), 0) AS total_estimated_cost,
    -- Projected profit
    (p.original_contract_value + COALESCE(SUM(ce.approved_cost) FILTER (WHERE ce.status = 'approved'), 0))
        - (COALESCE((SELECT SUM(amount) FROM qb_job_costs WHERE project_id = p.id), 0)
           + COALESCE((SELECT SUM(committed) - SUM(actual_costs) FROM procore_budget WHERE project_id = p.id), 0)) AS projected_profit,
    -- Billings to date
    COALESCE((SELECT SUM(amount_due) FROM invoices WHERE project_id = p.id AND invoice_type = 'pay_app'), 0) AS billings_to_date
FROM projects p
LEFT JOIN change_events ce ON p.id = ce.project_id
WHERE p.status IN ('active', 'pre_construction')
GROUP BY p.id, p.code, p.name, p.status, p.original_contract_value;

-- Project health score
CREATE OR REPLACE VIEW project_health AS
SELECT
    p.id AS project_id,
    p.code,
    p.name,
    COALESCE((SELECT COUNT(*) FROM rfis r WHERE r.project_id = p.id AND r.status = 'open' AND r.due_date < CURRENT_DATE), 0) AS overdue_rfis,
    COALESCE((SELECT COUNT(*) FROM submittals s WHERE s.project_id = p.id AND s.status IN ('pending','open') AND s.due_date < CURRENT_DATE), 0) AS overdue_submittals,
    COALESCE((SELECT COUNT(*) FROM punch_items pi WHERE pi.project_id = p.id AND pi.status != 'closed'), 0) AS open_punch_items,
    CASE WHEN p.estimated_completion_date IS NOT NULL
        THEN (p.estimated_completion_date - CURRENT_DATE)
        ELSE NULL END AS days_to_completion,
    CASE
        WHEN (SELECT COUNT(*) FROM rfis r WHERE r.project_id = p.id AND r.status = 'open' AND r.due_date < CURRENT_DATE) > 5 THEN 'RED'
        WHEN (SELECT COUNT(*) FROM rfis r WHERE r.project_id = p.id AND r.status = 'open' AND r.due_date < CURRENT_DATE) > 2 THEN 'YELLOW'
        WHEN (SELECT COUNT(*) FROM submittals s WHERE s.project_id = p.id AND s.status IN ('pending','open') AND s.due_date < CURRENT_DATE) > 3 THEN 'YELLOW'
        ELSE 'GREEN'
    END AS schedule_risk
FROM projects p
WHERE p.status IN ('active', 'pre_construction');

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE submittals ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE punch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE prime_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE qb_job_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE qb_ar_aging ENABLE ROW LEVEL SECURITY;
ALTER TABLE qb_ap_aging ENABLE ROW LEVEL SECURITY;
ALTER TABLE qb_bank_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE qb_profit_loss ENABLE ROW LEVEL SECURITY;
ALTER TABLE qb_cash_flow ENABLE ROW LEVEL SECURITY;
ALTER TABLE procore_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE procore_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE procore_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE procore_pay_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE procore_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE procore_change_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE unmatched_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE closeout_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_credentials ENABLE ROW LEVEL SECURITY;

-- Authenticated user policies (permissive for initial build — tighten per role later)
CREATE POLICY "Authenticated read all" ON organizations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON organization_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON project_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON staff FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON staff_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON capacity_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON rfis FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON change_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON submittals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON daily_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON punch_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON observations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON inspections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON subcontracts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON prime_contracts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON purchase_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON qb_job_costs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON qb_ar_aging FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON qb_ap_aging FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON qb_bank_balances FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON qb_profit_loss FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON qb_cash_flow FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON procore_sync_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON procore_projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON procore_contracts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON procore_pay_apps FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON procore_budget FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON procore_change_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON reconciliation_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON unmatched_projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON closeout_checklists FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON workflow_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read all" ON api_credentials FOR SELECT TO authenticated USING (true);

-- Service role can do everything (for Netlify functions)
CREATE POLICY "Service role full access" ON organizations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON projects FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON staff FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON staff_assignments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON capacity_rules FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON rfis FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON change_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON submittals FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON daily_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON punch_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON observations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON inspections FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON subcontracts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON invoices FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON prime_contracts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON purchase_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON qb_job_costs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON qb_ar_aging FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON qb_ap_aging FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON qb_bank_balances FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON qb_profit_loss FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON qb_cash_flow FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON procore_sync_log FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON procore_projects FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON procore_contracts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON procore_pay_apps FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON procore_budget FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON procore_change_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON reconciliation_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON unmatched_projects FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON closeout_checklists FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON documents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON workflow_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON api_credentials FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Insert/update policies for authenticated users
CREATE POLICY "Authenticated insert" ON staff_assignments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON staff_assignments FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON closeout_checklists FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON closeout_checklists FOR UPDATE TO authenticated USING (true);

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_staff_updated_at BEFORE UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_staff_assignments_updated_at BEFORE UPDATE ON staff_assignments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_rfis_updated_at BEFORE UPDATE ON rfis FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_change_events_updated_at BEFORE UPDATE ON change_events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_submittals_updated_at BEFORE UPDATE ON submittals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_daily_logs_updated_at BEFORE UPDATE ON daily_logs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_punch_items_updated_at BEFORE UPDATE ON punch_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_subcontracts_updated_at BEFORE UPDATE ON subcontracts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_api_credentials_updated_at BEFORE UPDATE ON api_credentials FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
