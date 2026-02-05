import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// Use env vars with hardcoded fallback for Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://eruvdljuqvvoxfnlraje.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVydXZkbGp1cXZ2b3hmbmxyYWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNTc5ODksImV4cCI6MjA4NTgzMzk4OX0.JeR6g6NJa7c9yohW19OWlS-EMKg650Jwf4WYXYQGBhU';
const supabase = createClient(supabaseUrl, supabaseKey);

// Procore API base URL
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

async function refreshAccessToken(tokens: TokenData): Promise<TokenData | null> {
  // Hardcoded Procore credentials as fallback
  const clientId = process.env.PROCORE_CLIENT_ID || '5m6ntNDYctNihGwfspa4OiG6EXHXx1HCXSHRVetAb7k';
  const clientSecret = process.env.PROCORE_CLIENT_SECRET || 'z-aqwtz7agk1fyEyXW10zsV4SGKrjNP58bGqXgD4vd0';

  if (!clientId || !clientSecret) return null;

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
  return {
    ...tokens,
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

async function procoreRequest(
  endpoint: string,
  tokens: TokenData,
  params?: Record<string, string>
): Promise<any> {
  const url = new URL(`${PROCORE_BASE_URL}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value) { // Only add if value exists
        url.searchParams.append(key, value);
      }
    });
  }

  console.log('Procore request:', url.toString(), 'company_id:', tokens.company_id);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json',
      ...(tokens.company_id ? { 'Procore-Company-Id': tokens.company_id } : {}),
    },
  });

  if (response.status === 401) {
    // Token expired, try to refresh
    const newTokens = await refreshAccessToken(tokens);
    if (newTokens) {
      return procoreRequest(endpoint, newTokens, params);
    }
    throw new Error('Authentication failed');
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Procore API error response:', errorText);
    throw new Error(`Procore API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

async function fetchAllPages(
  endpoint: string,
  tokens: TokenData,
  params?: Record<string, string>
): Promise<any[]> {
  const allData: any[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const pageParams = { ...params, page: String(page), per_page: String(perPage) };
    const data = await procoreRequest(endpoint, tokens, pageParams);

    if (!Array.isArray(data) || data.length === 0) break;
    allData.push(...data);
    if (data.length < perPage) break;
    page++;
  }

  return allData;
}

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { action, projectId, userId } = JSON.parse(event.body || '{}');

    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'User ID required' }),
      };
    }

    const tokens = await getStoredTokens(userId);
    if (!tokens) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Procore not connected. Please connect in Settings.' }),
      };
    }

    // Debug: Check if company_id exists
    console.log('Stored tokens company_id:', tokens.company_id);

    if (!tokens.company_id || tokens.company_id === 'undefined') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Invalid Procore company ID. Please disconnect and reconnect Procore in Settings.',
          debug: { company_id: tokens.company_id }
        }),
      };
    }

    let result: any;

    switch (action) {
      case 'getProjects':
        // Try v1.1 API which uses Procore-Company-Id header (already set)
        result = await fetchAllPages('/rest/v1.1/projects', tokens);
        break;

      case 'getProject':
        if (!projectId) throw new Error('Project ID required');
        result = await procoreRequest(`/rest/v1.0/projects/${projectId}`, tokens);
        break;

      case 'getVendors':
        if (!projectId) throw new Error('Project ID required');
        result = await fetchAllPages('/rest/v1.0/vendors', tokens, { project_id: projectId });
        break;

      case 'getCostCodes':
        if (!projectId) throw new Error('Project ID required');
        result = await fetchAllPages('/rest/v1.0/cost_codes', tokens, { project_id: projectId });
        break;

      case 'getCommitments':
        if (!projectId) throw new Error('Project ID required');
        const subcontracts = await fetchAllPages(
          '/rest/v1.0/work_order_contracts',
          tokens,
          { project_id: projectId }
        );
        const purchaseOrders = await fetchAllPages(
          '/rest/v1.0/purchase_order_contracts',
          tokens,
          { project_id: projectId }
        );
        result = { subcontracts, purchaseOrders };
        break;

      case 'getBudget':
        if (!projectId) throw new Error('Project ID required');
        const budgetViews = await procoreRequest('/rest/v1.0/budget_views', tokens, { project_id: projectId });
        if (budgetViews && budgetViews.length > 0) {
          result = await fetchAllPages(
            `/rest/v1.0/budget_views/${budgetViews[0].id}/detail_rows`,
            tokens,
            { project_id: projectId }
          );
        } else {
          result = [];
        }
        break;

      case 'getFullProjectData':
        if (!projectId) throw new Error('Project ID required');
        const [project, vendors, costCodes, commitments, budget] = await Promise.all([
          procoreRequest(`/rest/v1.0/projects/${projectId}`, tokens),
          fetchAllPages('/rest/v1.0/vendors', tokens, { project_id: projectId }),
          fetchAllPages('/rest/v1.0/cost_codes', tokens, { project_id: projectId }),
          (async () => {
            const subs = await fetchAllPages('/rest/v1.0/work_order_contracts', tokens, { project_id: projectId });
            const pos = await fetchAllPages('/rest/v1.0/purchase_order_contracts', tokens, { project_id: projectId });
            return { subcontracts: subs, purchaseOrders: pos };
          })(),
          (async () => {
            const views = await procoreRequest('/rest/v1.0/budget_views', tokens, { project_id: projectId });
            if (views && views.length > 0) {
              return fetchAllPages(`/rest/v1.0/budget_views/${views[0].id}/detail_rows`, tokens, { project_id: projectId });
            }
            return [];
          })(),
        ]);
        result = { project, vendors, costCodes, commitments, budget };
        break;

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' }),
        };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    };
  } catch (error: any) {
    console.error('Procore API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};
