-- =============================================================================
-- Migration 110: Field activity caching
-- =============================================================================
-- Caches the data the /field page needs (daily logs, photos, inspections,
-- observations, punch items) so the page can render from Supabase rather
-- than hammering Procore's API on every load. Procore is the source of truth;
-- these tables are populated by the field-sync Netlify function and are
-- safe to truncate and re-sync at any time.
--
-- The unique constraint on (procore_id, project_procore_id) on each detail
-- table makes upserts idempotent: re-running a sync replaces existing rows
-- rather than duplicating them.
-- =============================================================================

-- Track every sync attempt so the UI can show "last synced X minutes ago"
-- and drill into errors if a project failed.
CREATE TABLE IF NOT EXISTS field_sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_procore_id BIGINT NOT NULL,
    started_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    finished_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'running', -- running | success | partial | error
    daily_logs_count INTEGER DEFAULT 0,
    photos_count INTEGER DEFAULT 0,
    inspections_count INTEGER DEFAULT 0,
    observations_count INTEGER DEFAULT 0,
    punch_items_count INTEGER DEFAULT 0,
    error_message TEXT,
    diagnostics JSONB
);

CREATE INDEX IF NOT EXISTS idx_field_sync_runs_project
    ON field_sync_runs(project_procore_id, started_at DESC);

-- ----------------------------------------------------------------------------
-- Daily logs: union of manpower + notes (and any other types we add later).
-- The log_type column distinguishes them. `entry_date` is the *log* date
-- (the day the work happened), not the upload time.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_daily_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    procore_id BIGINT NOT NULL,
    project_procore_id BIGINT NOT NULL,
    log_type VARCHAR(50) NOT NULL,           -- manpower_logs, notes_logs, etc.
    entry_date DATE NOT NULL,                 -- the date the log is FOR
    vendor_name VARCHAR(255),                 -- manpower-specific
    num_workers NUMERIC,                      -- manpower-specific
    hours NUMERIC,                            -- manpower-specific
    notes TEXT,                               -- notes_logs body, or any narrative
    raw JSONB,                                -- full Procore payload, for fields we haven't normalized
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (project_procore_id, log_type, procore_id)
);

CREATE INDEX IF NOT EXISTS idx_field_daily_logs_project_date
    ON field_daily_logs(project_procore_id, entry_date DESC);

-- ----------------------------------------------------------------------------
-- Photos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    procore_id BIGINT NOT NULL,
    project_procore_id BIGINT NOT NULL,
    name VARCHAR(500),
    description TEXT,
    taken_at TIMESTAMPTZ,
    procore_created_at TIMESTAMPTZ,
    url TEXT,
    thumbnail_url TEXT,
    raw JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (project_procore_id, procore_id)
);

CREATE INDEX IF NOT EXISTS idx_field_photos_project_date
    ON field_photos(project_procore_id, COALESCE(taken_at, procore_created_at) DESC);

-- ----------------------------------------------------------------------------
-- Inspections (Procore checklists)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    procore_id BIGINT NOT NULL,
    project_procore_id BIGINT NOT NULL,
    name VARCHAR(500),
    status VARCHAR(50),                       -- draft | in_progress | closed
    inspection_date DATE,
    closed_at TIMESTAMPTZ,
    procore_updated_at TIMESTAMPTZ,
    raw JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (project_procore_id, procore_id)
);

CREATE INDEX IF NOT EXISTS idx_field_inspections_project_date
    ON field_inspections(project_procore_id, COALESCE(closed_at, procore_updated_at) DESC);

-- ----------------------------------------------------------------------------
-- Observations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    procore_id BIGINT NOT NULL,
    project_procore_id BIGINT NOT NULL,
    name VARCHAR(500),
    description TEXT,
    status VARCHAR(50),
    type_name VARCHAR(255),
    priority VARCHAR(50),
    due_date DATE,
    procore_created_at TIMESTAMPTZ,
    procore_updated_at TIMESTAMPTZ,
    raw JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (project_procore_id, procore_id)
);

CREATE INDEX IF NOT EXISTS idx_field_observations_project_date
    ON field_observations(project_procore_id, procore_created_at DESC);

-- ----------------------------------------------------------------------------
-- Punch list
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_punch_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    procore_id BIGINT NOT NULL,
    project_procore_id BIGINT NOT NULL,
    name VARCHAR(500),
    description TEXT,
    status VARCHAR(50),
    priority VARCHAR(50),
    due_date DATE,
    procore_created_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    procore_updated_at TIMESTAMPTZ,
    raw JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (project_procore_id, procore_id)
);

CREATE INDEX IF NOT EXISTS idx_field_punch_project_date
    ON field_punch_items(project_procore_id, procore_created_at DESC);

-- ----------------------------------------------------------------------------
-- RLS — permissive to match the rest of the app's pattern (auth gating
-- happens at the React/Netlify-function layer, not the database layer).
-- ----------------------------------------------------------------------------
ALTER TABLE field_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_punch_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- field_sync_runs
  CREATE POLICY "field_sync_runs_select" ON field_sync_runs FOR SELECT USING (true);
  CREATE POLICY "field_sync_runs_insert" ON field_sync_runs FOR INSERT WITH CHECK (true);
  CREATE POLICY "field_sync_runs_update" ON field_sync_runs FOR UPDATE USING (true);

  -- field_daily_logs
  CREATE POLICY "field_daily_logs_select" ON field_daily_logs FOR SELECT USING (true);
  CREATE POLICY "field_daily_logs_insert" ON field_daily_logs FOR INSERT WITH CHECK (true);
  CREATE POLICY "field_daily_logs_update" ON field_daily_logs FOR UPDATE USING (true);
  CREATE POLICY "field_daily_logs_delete" ON field_daily_logs FOR DELETE USING (true);

  -- field_photos
  CREATE POLICY "field_photos_select" ON field_photos FOR SELECT USING (true);
  CREATE POLICY "field_photos_insert" ON field_photos FOR INSERT WITH CHECK (true);
  CREATE POLICY "field_photos_update" ON field_photos FOR UPDATE USING (true);
  CREATE POLICY "field_photos_delete" ON field_photos FOR DELETE USING (true);

  -- field_inspections
  CREATE POLICY "field_inspections_select" ON field_inspections FOR SELECT USING (true);
  CREATE POLICY "field_inspections_insert" ON field_inspections FOR INSERT WITH CHECK (true);
  CREATE POLICY "field_inspections_update" ON field_inspections FOR UPDATE USING (true);
  CREATE POLICY "field_inspections_delete" ON field_inspections FOR DELETE USING (true);

  -- field_observations
  CREATE POLICY "field_observations_select" ON field_observations FOR SELECT USING (true);
  CREATE POLICY "field_observations_insert" ON field_observations FOR INSERT WITH CHECK (true);
  CREATE POLICY "field_observations_update" ON field_observations FOR UPDATE USING (true);
  CREATE POLICY "field_observations_delete" ON field_observations FOR DELETE USING (true);

  -- field_punch_items
  CREATE POLICY "field_punch_items_select" ON field_punch_items FOR SELECT USING (true);
  CREATE POLICY "field_punch_items_insert" ON field_punch_items FOR INSERT WITH CHECK (true);
  CREATE POLICY "field_punch_items_update" ON field_punch_items FOR UPDATE USING (true);
  CREATE POLICY "field_punch_items_delete" ON field_punch_items FOR DELETE USING (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

-- updated_at triggers
DROP TRIGGER IF EXISTS update_field_daily_logs_updated_at ON field_daily_logs;
DROP TRIGGER IF EXISTS update_field_photos_updated_at ON field_photos;
DROP TRIGGER IF EXISTS update_field_inspections_updated_at ON field_inspections;
DROP TRIGGER IF EXISTS update_field_observations_updated_at ON field_observations;
DROP TRIGGER IF EXISTS update_field_punch_items_updated_at ON field_punch_items;

CREATE TRIGGER update_field_daily_logs_updated_at
    BEFORE UPDATE ON field_daily_logs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_field_photos_updated_at
    BEFORE UPDATE ON field_photos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_field_inspections_updated_at
    BEFORE UPDATE ON field_inspections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_field_observations_updated_at
    BEFORE UPDATE ON field_observations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_field_punch_items_updated_at
    BEFORE UPDATE ON field_punch_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
