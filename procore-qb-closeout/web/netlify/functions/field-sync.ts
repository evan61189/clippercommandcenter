import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

/**
 * field-sync
 * ----------
 * Pulls field-side data from Procore for ONE active project and upserts it
 * into Supabase. The frontend calls this once per project (sequentially) so
 * that each invocation stays well within Netlify's 10-second timeout and
 * respects Procore's per-burst rate limits.
 *
 * POST body: { userId: string, projectId: number | string }
 * Returns:    { ok: bool, counts: {...}, run_id: uuid }
 */

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://eruvdljuqvvoxfnlraje.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVydXZkbGp1cXZ2b3hmbmxyYWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNTc5ODksImV4cCI6MjA4NTgzMzk4OX0.JeR6g6NJa7c9yohW19OWlS-EMKg650Jwf4WYXYQGBhU';
const supabase = createClient(supabaseUrl, supabaseKey);

const PROCORE_BASE_URL = 'https://api.procore.com';

interface TokenData {
  access_token: string;
  refresh_token: string;
  company_id: string;
  expires_at?: string;
}

// ---- Procore token + request helpers (mirrored from procore-data.ts) ----

async function getStoredTokens(userId: string): Promise<TokenData | null> {
  const { data, error } = await supabase
    .from('api_credentials')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'procore')
    .single();
  if (error || !data) return null;
  return data.credentials as TokenData;
}

async function refreshAccessToken(tokens: TokenData, userId?: string): Promise<TokenData | null> {
  const clientId = process.env.PROCORE_CLIENT_ID || '5m6ntNDYctNihGwfspa4OiG6EXHXx1HCXSHRVetAb7k';
  const clientSecret = process.env.PROCORE_CLIENT_SECRET || 'z-aqwtz7agk1fyEyXW10zsV4SGKrjNP58bGqXgD4vd0';
  const response = await fetch(`${PROCORE_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  const newTokens: TokenData = {
    ...tokens,
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
  if (userId) {
    await supabase
      .from('api_credentials')
      .update({ credentials: newTokens, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('provider', 'procore');
  }
  return newTokens;
}

async function procoreRequest(
  endpoint: string,
  tokens: TokenData,
  params?: Record<string, string>,
  userId?: string,
  retried = false
): Promise<any> {
  const url = new URL(`${PROCORE_BASE_URL}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.append(k, v); });
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
        ...(tokens.company_id ? { 'Procore-Company-Id': tokens.company_id } : {}),
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.status === 401 && !retried) {
      const fresh = await refreshAccessToken(tokens, userId);
      if (fresh) return procoreRequest(endpoint, fresh, params, userId, true);
      throw new Error('Auth failed');
    }
    if (response.status === 429) {
      const ra = response.headers.get('Retry-After');
      const wait = ra ? Math.min(parseInt(ra, 10) * 1000 || 2000, 8000) : 2000;
      await new Promise((r) => setTimeout(r, wait));
      // single retry; don't recurse forever
      const r2 = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json',
          ...(tokens.company_id ? { 'Procore-Company-Id': tokens.company_id } : {}),
        },
      });
      if (r2.ok) return await r2.json();
      throw new Error(`429 after retry: ${endpoint}`);
    }
    if (!response.ok) {
      const txt = await response.text();
      throw new Error(`${response.status}: ${txt.substring(0, 240)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchAllPages(
  endpoint: string,
  tokens: TokenData,
  params?: Record<string, string>,
  userId?: string
): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const data = await procoreRequest(endpoint, tokens, { ...params, page: String(page), per_page: String(perPage) }, userId);
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < perPage) break;
    page++;
    if (page > 5) break; // hard cap to keep within Netlify 10s
  }
  return all;
}

// ---- Sync logic ----

async function syncProject(userId: string, projectId: number, tokens: TokenData) {
  const companyId = tokens.company_id;
  const diagnostics: Array<{ label: string; ok: boolean; count: number; error?: string }> = [];

  // Open a sync run row so the UI can show progress.
  const { data: runRow } = await supabase
    .from('field_sync_runs')
    .insert({ project_procore_id: projectId, status: 'running' })
    .select()
    .single();
  const runId: string | undefined = runRow?.id;

  const safe = async <T,>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      const v = await fn();
      const count = Array.isArray(v) ? v.length : 1;
      diagnostics.push({ label, ok: true, count });
      return v;
    } catch (err: any) {
      diagnostics.push({ label, ok: false, count: 0, error: (err?.message || String(err)).substring(0, 240) });
      return fallback;
    }
  };

  const baseParams = { company_id: companyId, project_id: String(projectId) };

  // Daily-log endpoints return TODAY ONLY unless start_date/end_date are
  // provided. Pull a 30-day rolling window so the dashboard's 7-day view
  // is comfortably covered + we have a small buffer for date-flipped entries.
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  const dailyLogParams = {
    company_id: companyId,
    start_date: thirtyDaysAgo.toISOString().slice(0, 10),
    end_date: today.toISOString().slice(0, 10),
  };

  // 1. Daily logs (manpower + notes only — keep request count low)
  const manpower = await safe('manpower_logs',
    () => fetchAllPages(`/rest/v1.0/projects/${projectId}/manpower_logs`, tokens, dailyLogParams, userId), []);
  const notes = await safe('notes_logs',
    () => fetchAllPages(`/rest/v1.0/projects/${projectId}/notes_logs`, tokens, dailyLogParams, userId), []);
  // Pull a few more daily-log types so teams that use a different log subform
  // for their "daily report" still register as having filed something.
  const weather = await safe('weather_logs',
    () => fetchAllPages(`/rest/v1.0/projects/${projectId}/weather_logs`, tokens, dailyLogParams, userId), []);
  const delivery = await safe('delivery_logs',
    () => fetchAllPages(`/rest/v1.0/projects/${projectId}/delivery_logs`, tokens, dailyLogParams, userId), []);
  const equipment = await safe('equipment_logs',
    () => fetchAllPages(`/rest/v1.0/projects/${projectId}/equipment_logs`, tokens, dailyLogParams, userId), []);

  // 2. Photos — project-nested 404s in this account, use top-level with project_id filter
  const photos = await safe('photos',
    () => fetchAllPages(`/rest/v1.0/images`, tokens, baseParams, userId), []);

  // 3. Inspections
  const inspections = await safe('inspections',
    () => fetchAllPages(`/rest/v1.0/checklist/lists`, tokens, baseParams, userId), []);

  // 4. Observations
  const observations = await safe('observations',
    () => fetchAllPages(`/rest/v1.0/observations/items`, tokens, baseParams, userId), []);

  // 5. Punch items — project-nested 404s, use top-level with project_id filter
  const punch = await safe('punch_items',
    () => fetchAllPages(`/rest/v1.0/punch_items`, tokens, baseParams, userId), []);

  // ---- Upserts ----
  // Each upsert keys on (project_procore_id, procore_id) so a re-sync
  // updates the row in place rather than duplicating.

  const upserts: Promise<any>[] = [];

  if (manpower.length || notes.length || weather.length || delivery.length || equipment.length) {
    const todayISO = new Date().toISOString().slice(0, 10);
    const dateOf = (x: any) => x.date || x.log_date || (x.created_at && String(x.created_at).slice(0, 10)) || todayISO;
    const dailyRows = [
      ...manpower.map((m: any) => ({
        procore_id: m.id, project_procore_id: projectId, log_type: 'manpower_logs',
        entry_date: dateOf(m),
        vendor_name: m.vendor?.name || null,
        num_workers: m.num_workers ?? null,
        hours: m.hours ?? null,
        notes: null,
        raw: m,
      })),
      ...notes.map((n: any) => ({
        procore_id: n.id, project_procore_id: projectId, log_type: 'notes_logs',
        entry_date: dateOf(n),
        vendor_name: null, num_workers: null, hours: null,
        notes: n.notes || n.description || null,
        raw: n,
      })),
      ...weather.map((w: any) => ({
        procore_id: w.id, project_procore_id: projectId, log_type: 'weather_logs',
        entry_date: dateOf(w),
        vendor_name: null, num_workers: null, hours: null,
        notes: w.conditions || null,
        raw: w,
      })),
      ...delivery.map((d: any) => ({
        procore_id: d.id, project_procore_id: projectId, log_type: 'delivery_logs',
        entry_date: dateOf(d),
        vendor_name: d.vendor?.name || null,
        num_workers: null, hours: null,
        notes: d.delivery_contents || d.tracking_number || null,
        raw: d,
      })),
      ...equipment.map((e: any) => ({
        procore_id: e.id, project_procore_id: projectId, log_type: 'equipment_logs',
        entry_date: dateOf(e),
        vendor_name: e.vendor?.name || null,
        num_workers: null,
        hours: e.hours ?? null,
        notes: e.description || null,
        raw: e,
      })),
    ];
    upserts.push(
      supabase.from('field_daily_logs').upsert(dailyRows, { onConflict: 'project_procore_id,log_type,procore_id' })
    );
  }

  if (photos.length) {
    upserts.push(
      supabase.from('field_photos').upsert(
        photos.map((p: any) => ({
          procore_id: p.id,
          project_procore_id: projectId,
          name: p.name || null,
          description: p.description || null,
          taken_at: p.taken_at || null,
          procore_created_at: p.created_at || null,
          url: p.url || null,
          thumbnail_url: p.thumbnail_url || p.url || null,
          raw: p,
        })),
        { onConflict: 'project_procore_id,procore_id' }
      )
    );
  }

  if (inspections.length) {
    upserts.push(
      supabase.from('field_inspections').upsert(
        inspections.map((i: any) => ({
          procore_id: i.id,
          project_procore_id: projectId,
          name: i.name || null,
          status: i.status || null,
          inspection_date: i.inspection_date || null,
          closed_at: i.closed_at || null,
          procore_updated_at: i.updated_at || null,
          raw: i,
        })),
        { onConflict: 'project_procore_id,procore_id' }
      )
    );
  }

  if (observations.length) {
    upserts.push(
      supabase.from('field_observations').upsert(
        observations.map((o: any) => ({
          procore_id: o.id,
          project_procore_id: projectId,
          name: o.name || null,
          description: o.description || null,
          status: o.status || null,
          type_name: o.type?.name || null,
          priority: o.priority || null,
          due_date: o.due_date || null,
          procore_created_at: o.created_at || null,
          procore_updated_at: o.updated_at || null,
          raw: o,
        })),
        { onConflict: 'project_procore_id,procore_id' }
      )
    );
  }

  if (punch.length) {
    upserts.push(
      supabase.from('field_punch_items').upsert(
        punch.map((p: any) => ({
          procore_id: p.id,
          project_procore_id: projectId,
          name: p.name || null,
          description: p.description || null,
          status: p.status || null,
          priority: p.priority || null,
          due_date: p.due_date || null,
          procore_created_at: p.created_at || null,
          closed_at: p.closed_at || null,
          procore_updated_at: p.updated_at || null,
          raw: p,
        })),
        { onConflict: 'project_procore_id,procore_id' }
      )
    );
  }

  const upsertResults = await Promise.all(upserts);
  const upsertErrors = upsertResults.map((r: any) => r?.error).filter(Boolean);

  const counts = {
    daily_logs: manpower.length + notes.length + weather.length + delivery.length + equipment.length,
    photos: photos.length,
    inspections: inspections.length,
    observations: observations.length,
    punch_items: punch.length,
  };

  const allOk = diagnostics.every((d) => d.ok) && upsertErrors.length === 0;
  const someOk = diagnostics.some((d) => d.ok);
  const status = allOk ? 'success' : someOk ? 'partial' : 'error';

  // Close out the sync run row
  if (runId) {
    await supabase
      .from('field_sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        status,
        daily_logs_count: counts.daily_logs,
        photos_count: counts.photos,
        inspections_count: counts.inspections,
        observations_count: counts.observations,
        punch_items_count: counts.punch_items,
        error_message: upsertErrors.length ? upsertErrors.map((e: any) => e.message).join('; ').substring(0, 500) : null,
        diagnostics,
      })
      .eq('id', runId);
  }

  return { ok: allOk, status, counts, run_id: runId, diagnostics };
}

// ---- Handler ----

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { userId, projectId } = JSON.parse(event.body || '{}');
    if (!userId || !projectId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'userId and projectId required' }) };
    }
    const tokens = await getStoredTokens(userId);
    if (!tokens) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Procore not connected' }) };
    }
    const result = await syncProject(userId, Number(projectId), tokens);
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err: any) {
    console.error('field-sync error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err?.message || 'Internal error' }) };
  }
};
