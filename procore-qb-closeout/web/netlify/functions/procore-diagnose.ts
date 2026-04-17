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

// Raw fetch — NO safe() wrapper, returns full diagnostic info
async function rawProcore(
  label: string,
  endpoint: string,
  tokens: TokenData,
  params?: Record<string, string>
): Promise<{ label: string; endpoint: string; status: number; count: number | null; error: string | null; sample: any }> {
  try {
    const url = new URL(`${PROCORE_BASE_URL}${endpoint}`);
    if (params) Object.entries(params).forEach(([k, v]) => v && url.searchParams.append(k, v));

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
        ...(tokens.company_id ? { 'Procore-Company-Id': tokens.company_id } : {}),
      },
    });

    const status = res.status;

    if (!res.ok) {
      const errorBody = await res.text().catch(() => 'Could not read body');
      return { label, endpoint, status, count: null, error: errorBody.substring(0, 500), sample: null };
    }

    const body = await res.json();
    const isArray = Array.isArray(body);
    const count = isArray ? body.length : (body ? 1 : 0);
    // Return first item — all keys listed, values for important fields only
    const firstItem = isArray && body.length > 0 ? body[0] : (!isArray && body ? body : null);
    const sample = firstItem ? {
      _allKeys: Object.keys(firstItem),
      id: firstItem.id,
      title: firstItem.title,
      name: firstItem.name,
      status: firstItem.status,
      prime_contract_id: firstItem.prime_contract_id,
      prime_contract: firstItem.prime_contract,
      contract_id: firstItem.contract_id,
      parent: firstItem.parent,
      grand_total: firstItem.grand_total,
      original_value: firstItem.original_value,
      vendor: firstItem.vendor,
    } : null;

    return { label, endpoint, status, count, error: null, sample };
  } catch (err: any) {
    return { label, endpoint, status: 0, count: null, error: err.message, sample: null };
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
    const { userId } = JSON.parse(event.body || '{}');
    if (!userId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'userId required' }) };

    let tokens = await getStoredTokens(userId);
    if (!tokens) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not connected' }) };

    // Proactively refresh token
    if (tokens.expires_at) {
      const timeLeft = new Date(tokens.expires_at).getTime() - Date.now();
      if (timeLeft < 30 * 60 * 1000) {
        const refreshed = await refreshAccessToken(tokens, userId);
        if (refreshed) tokens = refreshed;
      }
    }

    const companyId = tokens.company_id;

    // Step 1: Get projects list
    const projectsResult = await rawProcore('projects', '/rest/v1.0/projects', tokens, {
      company_id: companyId,
      per_page: '5',
    });

    if (projectsResult.status !== 200 || !projectsResult.sample) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'Could not fetch projects — stopping here',
          results: [projectsResult],
        }),
      };
    }

    // Use the first project's ID for all endpoint tests
    const testProjectId = projectsResult.sample.id;
    const testProjectName = projectsResult.sample.name || projectsResult.sample.display_name;
    const projPath = `/rest/v1.0/projects/${testProjectId}`;
    const cp = { company_id: companyId };
    const fp = { company_id: companyId, project_id: String(testProjectId) };

    // Step 2: Test EVERY endpoint we use, both project-scoped and flat alternatives
    const results = await Promise.all([
      projectsResult, // Already done

      // Prime contract — test project-scoped and flat
      rawProcore('prime_contract (proj-scoped)', `${projPath}/prime_contract`, tokens, cp),
      rawProcore('prime_contract (flat)', '/rest/v1.0/prime_contract', tokens, fp),

      // Commitments — test both styles
      rawProcore('work_order_contracts (proj-scoped)', `${projPath}/work_order_contracts`, tokens, cp),
      rawProcore('work_order_contracts (flat)', '/rest/v1.0/work_order_contracts', tokens, fp),
      rawProcore('purchase_order_contracts (proj-scoped)', `${projPath}/purchase_order_contracts`, tokens, cp),
      rawProcore('purchase_order_contracts (flat)', '/rest/v1.0/purchase_order_contracts', tokens, fp),

      // Budget — test both styles
      rawProcore('budget_views (proj-scoped)', `${projPath}/budget_views`, tokens, cp),
      rawProcore('budget_views (flat)', '/rest/v1.0/budget_views', tokens, fp),

      // Change orders — test both project-level and flat
      rawProcore('change_order_packages (proj-scoped)', `${projPath}/change_order_packages`, tokens, cp),
      rawProcore('change_order_packages (flat)', '/rest/v1.0/change_order_packages', tokens, { ...cp, project_id: String(testProjectId) }),

      // Requisitions (sub invoices)
      rawProcore('requisitions (proj-scoped)', `${projPath}/requisitions`, tokens, cp),
      rawProcore('requisitions (flat)', '/rest/v1.0/requisitions', tokens, { ...cp, project_id: String(testProjectId) }),

      // RFIs
      rawProcore('rfis (proj-scoped)', `${projPath}/rfis`, tokens, cp),
      rawProcore('rfis (flat)', '/rest/v1.0/rfis', tokens, { ...cp, project_id: String(testProjectId) }),
      rawProcore('rfis (v1.1)', `/rest/v1.1/projects/${testProjectId}/rfis`, tokens, cp),

      // Submittals
      rawProcore('submittals (proj-scoped)', `${projPath}/submittals`, tokens, cp),
      rawProcore('submittals (flat)', '/rest/v1.0/submittals', tokens, { ...cp, project_id: String(testProjectId) }),

      // Punch items
      rawProcore('punch_items (proj-scoped)', `${projPath}/punch_items`, tokens, cp),
      rawProcore('punch_items (flat)', '/rest/v1.0/punch_items', tokens, { ...cp, project_id: String(testProjectId) }),

      // Direct costs
      rawProcore('direct_costs (proj-scoped)', `${projPath}/direct_costs`, tokens, cp),
      rawProcore('direct_costs (flat)', '/rest/v1.0/direct_costs', tokens, { ...cp, project_id: String(testProjectId) }),
    ]);

    // Fetch a budget detail row and dump ALL fields so we can see what's available
    const budgetViewResult = results.find(r => r.label === 'budget_views (flat)' && r.count && r.count > 0);
    let budgetRowSample: any = null;
    if (budgetViewResult && budgetViewResult.sample?.id) {
      try {
        const url = new URL(`${PROCORE_BASE_URL}/rest/v1.0/budget_views/${budgetViewResult.sample.id}/detail_rows`);
        url.searchParams.append('company_id', companyId);
        url.searchParams.append('project_id', String(testProjectId));
        url.searchParams.append('per_page', '3');
        const res = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            'Content-Type': 'application/json',
            ...(tokens.company_id ? { 'Procore-Company-Id': tokens.company_id } : {}),
          },
        });
        if (res.ok) {
          const rows = await res.json();
          if (Array.isArray(rows) && rows.length > 0) {
            // Return first 3 rows with ALL their fields
            budgetRowSample = rows.slice(0, 3).map((row: any) => {
              const flat: any = {};
              for (const [k, v] of Object.entries(row)) {
                if (v && typeof v === 'object' && !Array.isArray(v)) {
                  flat[k] = v; // keep nested objects as-is
                } else {
                  flat[k] = v;
                }
              }
              return flat;
            });
          }
        }
      } catch { /* non-critical */ }
    }

    // If we found a prime contract, also test payment_applications
    const primeResult = results.find(r => r.label.startsWith('prime_contract') && r.count && r.count > 0);
    if (primeResult && primeResult.sample) {
      const primeId = primeResult.sample.id;
      const payAppResults = await Promise.all([
        rawProcore('payment_applications (proj-scoped)', `${projPath}/prime_contract/${primeId}/payment_applications`, tokens, cp),
        rawProcore('payment_applications (flat)', `/rest/v1.0/payment_applications`, tokens, { ...cp, project_id: String(testProjectId), prime_contract_id: String(primeId) }),
      ]);
      results.push(...payAppResults);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        testProject: { id: testProjectId, name: testProjectName },
        companyId,
        tokenExpiresAt: tokens.expires_at,
        budgetRowSample,
        results: results.map(r => ({
          label: r.label,
          status: r.status,
          count: r.count,
          error: r.error,
          sampleKeys: r.sample ? Object.keys(r.sample) : null,
        })),
      }),
    };
  } catch (error: any) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
