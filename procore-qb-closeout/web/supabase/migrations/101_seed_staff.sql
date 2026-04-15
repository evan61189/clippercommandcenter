-- ============================================================
-- Clipper Command Terminal — Seed Data
-- Staff roster and capacity rules ONLY
-- ============================================================

-- Clipper Construction organization
INSERT INTO organizations (id, name, slug, logo_url, settings)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'Clipper Construction',
    'clipper',
    NULL,
    '{"branding": {"primary": "#1A1A1A", "accent": "#F5A623", "font": "Inter"}}'
);

-- Owner user
INSERT INTO users (id, email, first_name, last_name, role)
VALUES ('u0000000-0000-0000-0000-000000000001', 'evan@clipper.construction', 'Evan', 'Roberts', 'owner');

INSERT INTO organization_members (user_id, organization_id, role, title)
VALUES ('u0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'owner', 'Managing Partner');

-- Staff — Project Managers
INSERT INTO staff (id, first_name, last_name, email, phone, role, max_capacity_slots)
VALUES
    ('s0000000-0000-0000-0000-000000000001', 'Michael', 'Lynch', 'mlynch@clipper.construction', NULL, 'project_manager', 4),
    ('s0000000-0000-0000-0000-000000000002', 'Eddie', 'Collins', 'ecollins@clipper.construction', NULL, 'project_manager', 4);

-- Staff — Superintendents
INSERT INTO staff (id, first_name, last_name, email, phone, role, max_capacity_slots)
VALUES
    ('s0000000-0000-0000-0000-000000000003', 'James', 'Harmon', 'jharmon@clipper.construction', NULL, 'superintendent', 2),
    ('s0000000-0000-0000-0000-000000000004', 'Carlos', 'Rivera', 'crivera@clipper.construction', NULL, 'superintendent', 2),
    ('s0000000-0000-0000-0000-000000000005', 'Derek', 'Watts', 'dwatts@clipper.construction', NULL, 'superintendent', 2),
    ('s0000000-0000-0000-0000-000000000006', 'Brian', 'Okafor', 'bokafor@clipper.construction', NULL, 'superintendent', 2),
    ('s0000000-0000-0000-0000-000000000007', 'Tommy', 'Kessler', 'tkessler@clipper.construction', NULL, 'superintendent', 2);

-- Capacity rules
INSERT INTO capacity_rules (role, max_slots, large_job_threshold, large_job_slots, small_job_slots)
VALUES
    ('project_manager', 4, 600000, 1, 1),
    ('superintendent', 2, 600000, 2, 1);
