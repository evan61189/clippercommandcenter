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

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json',
      ...(tokens.company_id ? { 'Procore-Company-Id': tokens.company_id } : {}),
    },
  });

  if (res.status === 401 && userId) {
    const refreshed = await refreshAccessToken(tokens, userId);
    if (refreshed) return procoreGet(endpoint, refreshed, params, userId);
    throw new Error('Auth failed');
  }
  if (!res.ok) throw new Error(`Procore ${res.status}`);
  return res.json();
}

async function getOrgId(): Promise<string> {
  const { data } = await supabase.from('organizations').select('id').limit(1).single();
  return data?.id || '00000000-0000-0000-0000-000000000001';
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

    // Action: sync one project's details (contracts + subs)
    if (action === 'sync_project' && projectId) {
      console.log('Syncing project details:', projectId);

      // Get internal project ID
      const { data: proj } = await supabase.from('projects')
        .select('id, procore_project_id').eq('id', projectId).single();
      if (!proj) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Project not found' }) };

      const pcId = proj.procore_project_id;
      let contracts = 0, subs = 0;

      // Prime contracts
      try {
        const pcs = await procoreGet('/rest/v1.0/prime_contracts', tokens,
          { company_id: companyId, project_id: pcId, per_page: '50' }, userId);
        if (Array.isArray(pcs)) {
          for (const pc of pcs) {
            const val = pc.grand_total || pc.revised_grand_total || pc.original_value || 0;
            await supabase.from('projects').update({
              original_contract_value: pc.original_value || 0,
              current_contract_value: val,
            }).eq('id', proj.id);

            await supabase.from('prime_contracts').upsert({
              project_id: proj.id,
              procore_id: String(pc.id),
              title: pc.title || 'Prime Contract',
              number: pc.number || null,
              owner_name: pc.owner?.name || null,
              status: pc.status || 'active',
              contract_value: val,
              executed: !!pc.executed_date,
            }, { onConflict: 'procore_id', ignoreDuplicates: false });
            contracts++;
          }
        }
      } catch (e: any) { console.log('Prime contracts skipped:', e.message?.substring(0, 80)); }

      // Subcontracts
      try {
        const subList = await procoreGet('/rest/v1.0/work_order_contracts', tokens,
          { company_id: companyId, project_id: pcId, per_page: '100' }, userId);
        if (Array.isArray(subList)) {
          for (const sub of subList) {
            await supabase.from('subcontracts').upsert({
              project_id: proj.id,
              procore_id: String(sub.id),
              vendor_name: sub.vendor?.name || sub.title || 'Unknown',
              title: sub.title || null,
              number: sub.number || null,
              status: sub.status || 'active',
              contract_value: sub.grand_total || sub.original_value || 0,
              trade: sub.trade?.name || null,
              executed: !!sub.executed_date,
              signed_date: sub.executed_date || null,
            }, { onConflict: 'procore_id', ignoreDuplicates: false });
            subs++;
          }
        }
      } catch (e: any) { console.log('Subs skipped:', e.message?.substring(0, 80)); }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true, synced: { contracts, subcontracts: subs } }),
      };
    }

    // Default action: sync all projects (lightweight — just project list)
    console.log('Fetching projects for company:', companyId);
    const procoreProjects = await procoreGet('/rest/v1.0/projects', tokens,
      { company_id: companyId, per_page: '100' }, userId);

    if (!Array.isArray(procoreProjects)) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Unexpected Procore response' }) };
    }

    console.log(`Got ${procoreProjects.length} projects`);
    let synced = 0;

    for (const pp of procoreProjects) {
      const { error: projErr } = await supabase.from('projects').upsert({
        organization_id: orgId,
        procore_project_id: String(pp.id),
        name: pp.name || pp.display_name || 'Unnamed',
        code: pp.project_number || pp.code || null,
        status: pp.active ? 'active' : 'completed',
        address: [pp.address, pp.city, pp.state_code, pp.zip].filter(Boolean).join(', ') || null,
        start_date: pp.start_date || null,
        estimated_completion_date: pp.projected_finish_date || pp.completion_date || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'procore_project_id', ignoreDuplicates: false });

      if (projErr) {
        console.error('Project upsert error:', projErr.message);
        continue;
      }
      synced++;
    }

    console.log(`Synced ${synced} projects`);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, synced: { projects: synced } }),
    };
  } catch (error: any) {
    console.error('Sync error:', error.message);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
