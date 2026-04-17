import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://mctfnfczyznsecinspvi.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jdGZuZmN6eXpuc2VjaW5zcHZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTM2MjksImV4cCI6MjA5MTgyOTYyOX0.0uF7wtkT_4qUvLbXnacUijFVjXjEKhL3XComyQUPwXY';
const supabase = createClient(supabaseUrl, supabaseKey);

const PROCORE_BASE_URL = 'https://api.procore.com';

interface TokenData {
  access_token: string;
  refresh_token: string;
  company_id: string;
  expires_at?: string;
}

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

async function refreshAccessToken(tokens: TokenData, userId: string): Promise<TokenData | null> {
  const clientId = process.env.PROCORE_CLIENT_ID || '';
  const clientSecret = process.env.PROCORE_CLIENT_SECRET || '';
  const redirectUri = process.env.PROCORE_REDIRECT_URI || `${process.env.URL || 'https://clipper-command-terminal.netlify.app'}/.netlify/functions/oauth-callback?provider=procore`;

  console.log('Refreshing Procore token for user:', userId);
  console.log('Refresh token exists:', !!tokens.refresh_token);
  console.log('Token expires_at:', tokens.expires_at);

  const response = await fetch(`${PROCORE_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Procore token refresh failed:', response.status, errorText);
    return null;
  }

  const data = await response.json();
  const newTokens: TokenData = {
    ...tokens,
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };

  await supabase
    .from('api_credentials')
    .update({ credentials: newTokens, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('provider', 'procore');

  return newTokens;
}

async function procoreGet(endpoint: string, tokens: TokenData, params?: Record<string, string>, userId?: string): Promise<any> {
  if (tokens.expires_at && userId) {
    const timeLeft = new Date(tokens.expires_at).getTime() - Date.now();
    if (timeLeft < 30 * 60 * 1000) {
      const refreshed = await refreshAccessToken(tokens, userId);
      if (refreshed) tokens = refreshed;
    }
  }

  const url = new URL(`${PROCORE_BASE_URL}${endpoint}`);
  if (params) Object.entries(params).forEach(([k, v]) => v && url.searchParams.append(k, v));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
        ...(tokens.company_id ? { 'Procore-Company-Id': tokens.company_id } : {}),
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.status === 401 && userId) {
      console.log('Got 401, attempting token refresh...');
      const refreshed = await refreshAccessToken(tokens, userId);
      if (refreshed) return procoreGet(endpoint, refreshed, params, userId);
      throw new Error('Auth failed — your Procore session has expired. Please disconnect and reconnect in Settings.');
    }
    if (res.status === 403 || res.status === 404) return []; // Graceful skip
    if (!res.ok) throw new Error(`Procore ${res.status}`);
    return res.json();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') return []; // Timeout = skip gracefully
    throw error;
  }
}

async function fetchAllPages(endpoint: string, tokens: TokenData, params?: Record<string, string>, userId?: string): Promise<any[]> {
  const allData: any[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const pageParams = { ...params, page: String(page), per_page: String(perPage) };
    const data = await procoreGet(endpoint, tokens, pageParams, userId);
    if (!Array.isArray(data) || data.length === 0) break;
    allData.push(...data);
    if (data.length < perPage) break;
    page++;
  }

  return allData;
}

async function getOrgId(): Promise<string> {
  const { data } = await supabase.from('organizations').select('id').limit(1).single();
  return data?.id || '00000000-0000-0000-0000-000000000001';
}

// Safe fetch wrapper - returns default on error
async function safe<T>(fn: () => Promise<T>, defaultVal: T): Promise<T> {
  try { return await fn(); } catch { return defaultVal; }
}

interface SyncCounts {
  projects: number;
  contracts: number;
  subcontracts: number;
  purchase_orders: number;
  change_orders: number;
  pay_apps: number;
  sub_invoices: number;
  direct_costs: number;
  budget_lines: number;
  rfis: number;
  submittals: number;
  punch_items: number;
}

// Sync all financial + risk data for a single project
async function syncProjectDetails(
  internalId: string,
  procoreProjectId: string,
  tokens: TokenData,
  companyId: string,
  userId: string,
  counts: SyncCounts
): Promise<void> {
  const p = { company_id: companyId, project_id: procoreProjectId };

  // --- FINANCIAL DATA (parallel fetch) ---
  const [primeContracts, subList, poList, budgetViews] = await Promise.all([
    safe(() => fetchAllPages('/rest/v1.0/prime_contracts', tokens, { ...p, per_page: '50' }, userId), []),
    safe(() => fetchAllPages('/rest/v1.0/work_order_contracts', tokens, p, userId), []),
    safe(() => fetchAllPages('/rest/v1.0/purchase_order_contracts', tokens, p, userId), []),
    safe(() => procoreGet('/rest/v1.0/budget_views', tokens, p, userId), []),
  ]);

  // Prime contracts → update project contract values
  for (const pc of primeContracts) {
    const val = pc.grand_total || pc.revised_grand_total || pc.original_value || 0;
    await supabase.from('projects').update({
      original_contract_value: pc.original_value || 0,
      current_contract_value: val,
    }).eq('id', internalId);

    await supabase.from('prime_contracts').upsert({
      project_id: internalId,
      procore_id: String(pc.id),
      title: pc.title || 'Prime Contract',
      number: pc.number || null,
      owner_name: pc.owner?.name || null,
      status: pc.status || 'active',
      contract_value: val,
      retainage_percent: pc.retainage_percent || null,
      executed: !!pc.executed_date,
    }, { onConflict: 'procore_id', ignoreDuplicates: false });
    counts.contracts++;
  }

  // Subcontracts
  for (const sub of subList) {
    // Procore vendor info may be in vendor object, contractor, or separate fields
    const vendorName = sub.vendor?.name || sub.vendor?.company || sub.contractor?.name || sub.assignee?.company?.name || null;
    await supabase.from('subcontracts').upsert({
      project_id: internalId,
      procore_id: String(sub.id),
      vendor_name: vendorName || sub.title || 'Unknown',
      title: sub.title || null,
      number: sub.number || null,
      status: sub.status || 'active',
      contract_value: sub.grand_total || sub.original_value || 0,
      trade: sub.trade?.name || null,
      executed: !!sub.executed_date,
      signed_date: sub.executed_date || null,
    }, { onConflict: 'procore_id', ignoreDuplicates: false });
    counts.subcontracts++;
  }

  // Purchase orders
  for (const po of poList) {
    await supabase.from('purchase_orders').upsert({
      project_id: internalId,
      procore_id: String(po.id),
      title: po.title || null,
      number: po.number || null,
      vendor_name: po.vendor?.name || 'Unknown',
      status: po.status || 'active',
      po_value: po.grand_total || po.original_value || 0,
      delivery_date: po.delivery_date || null,
    }, { onConflict: 'procore_id', ignoreDuplicates: false });
    counts.purchase_orders++;
  }

  // Budget line items
  if (Array.isArray(budgetViews) && budgetViews.length > 0) {
    const budgetRows = await safe(() =>
      fetchAllPages(`/rest/v1.0/budget_views/${budgetViews[0].id}/detail_rows`, tokens,
        { project_id: procoreProjectId, company_id: companyId }, userId
      ), []);

    // Clear old budget for this project
    await supabase.from('procore_budget').delete().eq('project_id', internalId);

    const budgetInserts = budgetRows.map((row: any) => ({
      project_id: internalId,
      cost_code: row.cost_code?.full_code || row.cost_code?.name || null,
      description: row.description || row.cost_code?.name || null,
      original_budget: row.original_budget_amount || 0,
      budget_changes: row.budget_modifications || 0,
      revised_budget: row.revised_budget_amount || row.original_budget_amount || 0,
      committed: row.approved_cos || row.committed_amount || 0,
      actual_costs: row.direct_costs || 0,
      projected_cost: row.projected_budget || row.forecasted_cost || 0,
      over_under: row.over_under_amount || 0,
      synced_at: new Date().toISOString(),
    }));

    for (let i = 0; i < budgetInserts.length; i += 500) {
      const chunk = budgetInserts.slice(i, i + 500);
      const { error } = await supabase.from('procore_budget').insert(chunk);
      if (!error) counts.budget_lines += chunk.length;
    }
  }

  // --- CHANGE ORDERS, PAY APPS, SUB INVOICES, DIRECT COSTS (parallel) ---
  const primeContractIds = new Set(primeContracts.map((pc: any) => String(pc.id)));

  const [commitmentCOs, primeCOs, requisitions, payApps, directCostsList] = await Promise.all([
    safe(() => fetchAllPages('/rest/v1.0/change_order_packages', tokens, p, userId), []),
    safe(() => fetchAllPages('/rest/v1.0/prime_contract/change_order_packages', tokens, p, userId), []),
    safe(() => fetchAllPages('/rest/v1.1/requisitions', tokens, p, userId), []),
    safe(() => fetchAllPages('/rest/v1.1/payment_applications', tokens, p, userId), []),
    safe(() => fetchAllPages(`/rest/v1.0/projects/${procoreProjectId}/direct_costs`, tokens, { company_id: companyId }, userId), []),
  ]);

  // Change orders (both prime and commitment)
  for (const co of commitmentCOs) {
    await supabase.from('procore_change_orders').upsert({
      project_id: internalId,
      procore_id: String(co.id),
      number: co.number || null,
      title: co.title || null,
      status: co.status || 'draft',
      amount: co.grand_total || co.amount || 0,
      change_type: 'commitment',
      synced_at: new Date().toISOString(),
    }, { onConflict: 'procore_id', ignoreDuplicates: false });
    counts.change_orders++;
  }

  for (const co of primeCOs) {
    await supabase.from('procore_change_orders').upsert({
      project_id: internalId,
      procore_id: `prime_${co.id}`,
      number: co.number || null,
      title: co.title || null,
      status: co.status || 'draft',
      amount: co.grand_total || co.amount || 0,
      change_type: 'prime',
      synced_at: new Date().toISOString(),
    }, { onConflict: 'procore_id', ignoreDuplicates: false });
    counts.change_orders++;
  }

  // Subcontractor invoices (requisitions) — filter to this project
  const projectReqs = requisitions.filter((r: any) => String(r.project_id) === procoreProjectId);
  for (const req of projectReqs) {
    await supabase.from('procore_pay_apps').upsert({
      project_id: internalId,
      procore_id: `sub_${req.id}`,
      number: req.number || req.invoice_number || null,
      vendor_name: req.vendor_name || req.vendor?.name || null,
      period_end: req.period_end || req.billing_date || null,
      scheduled_value: req.g702_total_completed_and_stored_to_date || req.total_claimed_amount || 0,
      completed_previous: req.work_completed_from_previous_application || 0,
      completed_this_period: req.work_completed_this_period || 0,
      stored_materials: req.materials_presently_stored || 0,
      total_completed: req.g702_total_completed_and_stored_to_date || req.total_completed_and_stored_to_date || 0,
      retainage: req.total_retainage || 0,
      amount_due: req.g702_current_payment_due || req.payment_due || req.net_amount || 0,
      status: req.status || 'draft',
      synced_at: new Date().toISOString(),
    }, { onConflict: 'procore_id', ignoreDuplicates: false });
    counts.sub_invoices++;
  }

  // Payment applications (billings to owner) — filter to this project's prime contracts
  const projectPayApps = payApps.filter((app: any) => {
    const contractId = String(app.prime_contract_id || app.contract_id || '');
    return primeContractIds.has(contractId) || String(app.project_id) === procoreProjectId;
  });

  for (const app of projectPayApps) {
    await supabase.from('procore_pay_apps').upsert({
      project_id: internalId,
      procore_id: `owner_${app.id}`,
      number: app.number || null,
      vendor_name: '__OWNER__', // Special marker for owner-side pay apps
      period_end: app.period_end || app.billing_date || null,
      scheduled_value: app.total_scheduled_value || 0,
      completed_previous: app.total_completed_from_previous || 0,
      completed_this_period: app.total_completed_this_period || 0,
      stored_materials: app.total_stored_materials || 0,
      total_completed: app.total_completed_and_stored_to_date || 0,
      retainage: app.total_retainage || 0,
      amount_due: app.current_payment_due || app.amount_due || 0,
      status: app.status || 'draft',
      synced_at: new Date().toISOString(),
    }, { onConflict: 'procore_id', ignoreDuplicates: false });
    counts.pay_apps++;
  }

  // Direct costs
  for (const dc of directCostsList) {
    await supabase.from('direct_costs').upsert({
      project_id: internalId,
      procore_id: String(dc.id),
      description: dc.description || null,
      vendor_name: dc.vendor?.name || null,
      amount: dc.amount || 0,
      cost_code: dc.cost_code?.full_code || dc.cost_code?.name || null,
      date: dc.received_date || dc.invoice_date || null,
      status: dc.status || 'approved',
      synced_at: new Date().toISOString(),
    }, { onConflict: 'procore_id', ignoreDuplicates: false });
    counts.direct_costs++;
  }

  // --- RISK DATA (parallel) ---
  const [rfiList, submittalList, punchList] = await Promise.all([
    safe(() => fetchAllPages(`/rest/v1.0/projects/${procoreProjectId}/rfis`, tokens, { company_id: companyId }, userId), []),
    safe(() => fetchAllPages(`/rest/v1.0/projects/${procoreProjectId}/submittals`, tokens, { company_id: companyId }, userId), []),
    safe(() => fetchAllPages(`/rest/v1.0/projects/${procoreProjectId}/punch_items`, tokens, { company_id: companyId }, userId), []),
  ]);

  // RFIs
  for (const rfi of rfiList) {
    await supabase.from('rfis').upsert({
      project_id: internalId,
      procore_id: String(rfi.id),
      number: rfi.number || null,
      subject: rfi.subject || null,
      question: rfi.question?.body || rfi.question || null,
      status: rfi.status || 'open',
      priority: rfi.priority || null,
      due_date: rfi.due_date || null,
      answer: rfi.answer?.body || rfi.official_response || null,
      responded_at: rfi.responded_at || rfi.closed_at || null,
      cost_impact: rfi.cost_impact?.amount || null,
      schedule_impact: rfi.schedule_impact || null,
      created_at: rfi.created_at || new Date().toISOString(),
    }, { onConflict: 'procore_id', ignoreDuplicates: false });
    counts.rfis++;
  }

  // Submittals
  for (const sub of submittalList) {
    await supabase.from('submittals').upsert({
      project_id: internalId,
      procore_id: String(sub.id),
      number: sub.number || null,
      title: sub.title || null,
      type: sub.type?.name || sub.type || null,
      spec_section: sub.specification_section?.number || sub.spec_section || null,
      status: sub.status?.name || sub.status || 'open',
      priority: sub.priority || null,
      due_date: sub.due_date || null,
      required_on_site_date: sub.required_on_site_date || null,
      lead_time_days: sub.lead_time || null,
      created_at: sub.created_at || new Date().toISOString(),
    }, { onConflict: 'procore_id', ignoreDuplicates: false });
    counts.submittals++;
  }

  // Punch items
  for (const item of punchList) {
    await supabase.from('punch_items').upsert({
      project_id: internalId,
      procore_id: String(item.id),
      number: item.number || null,
      name: item.name || item.title || null,
      description: item.description || null,
      status: item.status?.name || item.status || 'open',
      priority: item.priority || null,
      location: item.location?.name || item.location || null,
      trade: item.trade?.name || null,
      assigned_to_name: item.assignee?.name || item.ball_in_court?.name || null,
      due_date: item.due_date || null,
      date_initiated: item.created_at ? item.created_at.split('T')[0] : null,
      date_closed: item.closed_at ? item.closed_at.split('T')[0] : null,
    }, { onConflict: 'procore_id', ignoreDuplicates: false });
    counts.punch_items++;
  }
}

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { userId, action, projectId } = JSON.parse(event.body || '{}');
    if (!userId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'userId required' }) };

    const tokens = await getStoredTokens(userId);
    if (!tokens) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Procore not connected' }) };

    const companyId = tokens.company_id;
    const orgId = await getOrgId();
    const startTime = Date.now();

    const counts: SyncCounts = {
      projects: 0, contracts: 0, subcontracts: 0, purchase_orders: 0,
      change_orders: 0, pay_apps: 0, sub_invoices: 0, direct_costs: 0,
      budget_lines: 0, rfis: 0, submittals: 0, punch_items: 0,
    };

    // --- Action: sync one project's full details ---
    if (action === 'sync_project' && projectId) {
      const { data: proj } = await supabase.from('projects')
        .select('id, procore_project_id').eq('id', projectId).single();
      if (!proj) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Project not found' }) };

      await syncProjectDetails(proj.id, proj.procore_project_id, tokens, companyId, userId, counts);

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true, synced: counts }),
      };
    }

    // --- Default: full sync (projects list + details for active projects) ---
    console.log('Fetching projects for company:', companyId);
    const procoreProjects = await procoreGet('/rest/v1.0/projects', tokens,
      { company_id: companyId, per_page: '100' }, userId);

    if (!Array.isArray(procoreProjects)) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Unexpected Procore response' }) };
    }

    // Step 1: Sync project list
    const projectMap: Record<string, { id: string; procoreId: string; active: boolean }> = {};

    for (const pp of procoreProjects) {
      const isActive = pp.active !== false;
      const { data: upserted, error: projErr } = await supabase.from('projects').upsert({
        organization_id: orgId,
        procore_project_id: String(pp.id),
        name: pp.name || pp.display_name || 'Unnamed',
        code: pp.project_number || pp.code || null,
        status: isActive ? 'active' : 'completed',
        address: pp.address ? { street: pp.address, city: pp.city, state: pp.state_code, zip: pp.zip } : null,
        start_date: pp.start_date || null,
        estimated_completion_date: pp.projected_finish_date || pp.completion_date || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'procore_project_id', ignoreDuplicates: false }).select('id, procore_project_id');

      if (projErr) {
        console.error('Project upsert error:', projErr.message);
        continue;
      }

      counts.projects++;
      if (upserted?.[0] && isActive) {
        projectMap[String(pp.id)] = {
          id: upserted[0].id,
          procoreId: String(pp.id),
          active: isActive,
        };
      }
    }

    console.log(`Synced ${counts.projects} projects, ${Object.keys(projectMap).length} active`);

    // Step 2: Sync financial + risk details for active projects
    // Process in batches of 3 to stay within time limits
    const activeProjects = Object.values(projectMap);
    let projectsSynced = 0;

    for (let i = 0; i < activeProjects.length; i += 3) {
      // Time guard: stop if we're running close to timeout (leave 5s buffer)
      if (Date.now() - startTime > 20000) {
        console.log(`Time guard: stopping after ${projectsSynced} project details (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
        break;
      }

      const batch = activeProjects.slice(i, i + 3);
      await Promise.allSettled(
        batch.map(proj =>
          syncProjectDetails(proj.id, proj.procoreId, tokens, companyId, userId, counts)
            .then(() => { projectsSynced++; })
            .catch(err => console.error(`Failed to sync project ${proj.procoreId}:`, err.message?.substring(0, 100)))
        )
      );
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`Full sync complete in ${elapsed}s: ${projectsSynced}/${activeProjects.length} projects detailed`);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        synced: counts,
        projects_detailed: projectsSynced,
        total_active: activeProjects.length,
        elapsed_seconds: elapsed,
      }),
    };
  } catch (error: any) {
    console.error('Sync error:', error.message);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
