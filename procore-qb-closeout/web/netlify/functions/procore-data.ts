import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// Use env vars with hardcoded fallback for Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://mctfnfczyznsecinspvi.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jdGZuZmN6eXpuc2VjaW5zcHZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTM2MjksImV4cCI6MjA5MTgyOTYyOX0.0uF7wtkT_4qUvLbXnacUijFVjXjEKhL3XComyQUPwXY';
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

async function refreshAccessToken(tokens: TokenData, userId?: string): Promise<TokenData | null> {
  // Hardcoded Procore credentials as fallback
  const clientId = process.env.PROCORE_CLIENT_ID || '5m6ntNDYctNihGwfspa4OiG6EXHXx1HCXSHRVetAb7k';
  const clientSecret = process.env.PROCORE_CLIENT_SECRET || 'z-aqwtz7agk1fyEyXW10zsV4SGKrjNP58bGqXgD4vd0';

  if (!clientId || !clientSecret) {
    console.error('Procore client credentials not configured');
    return null;
  }

  console.log('Attempting Procore token refresh...');

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

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Procore token refresh failed: ${response.status}`, errorBody);
    // If refresh token is invalid/expired, user needs to reconnect
    if (response.status === 400 || response.status === 401) {
      console.error('Procore refresh token expired - user must reconnect');
    }
    return null;
  }

  const data = await response.json();
  console.log('Procore token refresh successful');

  const newTokens: TokenData = {
    ...tokens,
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };

  // Update stored tokens if userId is provided
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
  userId?: string
): Promise<any> {
  // Proactive token refresh - check if token expires in less than 30 minutes
  // This keeps the refresh token active and prevents expiration from non-use
  if (tokens.expires_at) {
    const expiresAt = new Date(tokens.expires_at);
    const now = new Date();
    const timeUntilExpiry = expiresAt.getTime() - now.getTime();
    if (timeUntilExpiry < 30 * 60 * 1000) {
      console.log(`Procore token expiring in ${Math.round(timeUntilExpiry / 60000)} minutes, refreshing proactively...`);
      const newTokens = await refreshAccessToken(tokens, userId);
      if (newTokens) {
        tokens = newTokens;
      }
    }
  }

  const url = new URL(`${PROCORE_BASE_URL}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value) { // Only add if value exists
        url.searchParams.append(key, value);
      }
    });
  }

  console.log('Procore request:', url.toString());

  // Add timeout using AbortController (8 seconds to stay under Netlify's 10s limit)
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

    console.log('Procore response status:', response.status);

    if (response.status === 401) {
      // Token expired, try to refresh
      console.log('Procore 401 error, attempting token refresh...');
      const newTokens = await refreshAccessToken(tokens, userId);
      if (newTokens) {
        return procoreRequest(endpoint, newTokens, params, userId);
      }
      throw new Error('Authentication failed - token refresh failed. Please reconnect Procore in Settings.');
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Procore API error response:', response.status, errorText);
      throw new Error(`Procore API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Procore response data type:', typeof data, Array.isArray(data) ? `array length: ${data.length}` : '');
    return data;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Procore API request timed out. Please try again.');
    }
    console.error('Procore request error:', error);
    throw error;
  }
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

    const companyId = tokens.company_id;
    console.log('Processing action:', action, 'companyId:', companyId);

    switch (action) {
      case 'debug':
        // Debug action to check what's available
        console.log('Debug: Fetching available companies...');
        const companiesResp = await procoreRequest('/rest/v1.0/companies', tokens);
        console.log('Available companies:', JSON.stringify(companiesResp));
        result = {
          stored_company_id: companyId,
          available_companies: companiesResp,
          token_preview: tokens.access_token?.substring(0, 20) + '...'
        };
        break;

      case 'testConnection':
        // Simple test to verify API auth works
        console.log('Testing Procore connection...');
        result = await procoreRequest('/rest/v1.1/me', tokens);
        console.log('Test result:', result);
        break;

      case 'getProjects':
        // Use /rest/v1.0/projects with company_id as query param (header is also sent)
        console.log('Fetching projects for company:', companyId);
        try {
          result = await procoreRequest('/rest/v1.0/projects', tokens, {
            company_id: companyId,
            per_page: '50'
          });
          // Ensure result is an array
          if (!Array.isArray(result)) {
            console.log('Projects response is not an array:', typeof result, result);
            result = [];
          }
          console.log('Projects fetched:', result.length);
          // Debug: Log first project's status/stage fields to understand the data structure
          if (result.length > 0) {
            const sampleProject = result[0];
            console.log('Sample project fields:', JSON.stringify({
              id: sampleProject.id,
              name: sampleProject.name,
              status: sampleProject.status,
              stage: sampleProject.stage,
              project_stage: sampleProject.project_stage,
              active: sampleProject.active,
              // Log all keys to find the right field
              allKeys: Object.keys(sampleProject)
            }, null, 2));
          }
        } catch (err: any) {
          console.error('Failed to fetch projects:', err.message);
          throw err;
        }
        break;

      case 'getProject':
        if (!projectId) throw new Error('Project ID required');
        result = await procoreRequest(`/rest/v1.0/projects/${projectId}`, tokens, { company_id: companyId });
        break;

      case 'getVendors':
        if (!projectId) throw new Error('Project ID required');
        result = await fetchAllPages(`/rest/v1.0/projects/${projectId}/vendors`, tokens, { company_id: companyId });
        break;

      case 'getCostCodes':
        if (!projectId) throw new Error('Project ID required');
        result = await fetchAllPages(`/rest/v1.0/projects/${projectId}/cost_codes`, tokens, { company_id: companyId });
        break;

      case 'getCommitments':
        if (!projectId) throw new Error('Project ID required');
        const subcontracts = await fetchAllPages(
          `/rest/v1.0/projects/${projectId}/work_order_contracts`,
          tokens,
          { company_id: companyId }
        );
        const purchaseOrders = await fetchAllPages(
          `/rest/v1.0/projects/${projectId}/purchase_order_contracts`,
          tokens,
          { company_id: companyId }
        );
        result = { subcontracts, purchaseOrders };
        break;

      case 'getBudget':
        if (!projectId) throw new Error('Project ID required');
        const budgetViews = await procoreRequest(`/rest/v1.0/projects/${projectId}/budget_views`, tokens, { company_id: companyId });
        if (budgetViews && budgetViews.length > 0) {
          result = await fetchAllPages(
            `/rest/v1.0/budget_views/${budgetViews[0].id}/detail_rows`,
            tokens,
            { project_id: projectId, company_id: companyId }
          );
        } else {
          result = [];
        }
        break;

      case 'getFullProjectData':
        if (!projectId) throw new Error('Project ID required');

        // Helper to safely fetch data - returns empty on 404/403
        const safeRequest = async (fn: () => Promise<any>, defaultValue: any = []) => {
          try {
            return await fn();
          } catch (err: any) {
            const errMsg = err?.message || String(err);
            // Check for 404, 403, or any "not found" type errors
            if (errMsg.includes('404') || errMsg.includes('403') || errMsg.includes('Not Found') || errMsg.includes('not found')) {
              console.log('Endpoint returned 404/403, using default value for:', errMsg.substring(0, 100));
              return defaultValue;
            }
            console.error('safeRequest error (re-throwing):', errMsg.substring(0, 200));
            throw err;
          }
        };

        // First fetch prime contracts to get their IDs for payment application filtering
        const primeContract = await safeRequest(async () => {
          const pcs = await fetchAllPages(`/rest/v1.0/prime_contracts`, tokens, { company_id: companyId, project_id: projectId });
          console.log(`Found ${pcs.length} prime contracts`);
          return pcs;
        });

        // Build set of prime contract IDs for this project
        const primeContractIds = new Set<string>();
        for (const pc of primeContract || []) {
          primeContractIds.add(String(pc.id));
        }
        console.log(`Project has ${primeContractIds.size} prime contract IDs`);

        const [
          project,
          vendors,
          costCodes,
          commitments,
          budget,
          subInvoices,
          paymentApplications,
          changeOrders,
          directCosts
        ] = await Promise.all([
          // Basic project info
          safeRequest(() => procoreRequest(`/rest/v1.0/projects/${projectId}`, tokens, { company_id: companyId }), {}),
          // Vendors
          safeRequest(() => fetchAllPages(`/rest/v1.0/projects/${projectId}/vendors`, tokens, { company_id: companyId })),
          // Cost codes - use path-based project endpoint
          safeRequest(() => fetchAllPages(`/rest/v1.0/projects/${projectId}/cost_codes`, tokens, { company_id: companyId })),
          // Commitments (subcontracts & POs)
          safeRequest(async () => {
            const subs = await safeRequest(() => fetchAllPages(`/rest/v1.0/work_order_contracts`, tokens, { company_id: companyId, project_id: projectId }));
            const pos = await safeRequest(() => fetchAllPages(`/rest/v1.0/purchase_order_contracts`, tokens, { company_id: companyId, project_id: projectId }));
            return { subcontracts: subs, purchaseOrders: pos };
          }, { subcontracts: [], purchaseOrders: [] }),
          // Budget
          safeRequest(async () => {
            const views = await procoreRequest(`/rest/v1.0/budget_views`, tokens, { company_id: companyId, project_id: projectId });
            if (views && views.length > 0) {
              return fetchAllPages(`/rest/v1.0/budget_views/${views[0].id}/detail_rows`, tokens, { project_id: projectId, company_id: companyId });
            }
            return [];
          }),
          // Subcontractor invoices (requisitions) - try v1.1 API with query params
          safeRequest(async () => {
            console.log(`Fetching requisitions with v1.1 API for project ${projectId}...`);
            const reqs = await fetchAllPages(`/rest/v1.1/requisitions`, tokens, { company_id: companyId, project_id: projectId });
            console.log(`Requisitions v1.1 returned ${reqs.length} items (before filter)`);

            // Filter to only this project's requisitions (API may return all)
            const filteredReqs = reqs.filter((req: any) => String(req.project_id) === String(projectId));
            console.log(`Requisitions after project filter: ${filteredReqs.length} items`);

            // Debug: Log first requisition with ALL fields to identify correct amount field
            if (filteredReqs.length > 0) {
              const firstReq = filteredReqs[0];
              console.log('=== REQUISITION DEBUG (First Invoice) ===');
              console.log('All keys:', Object.keys(firstReq).join(', '));
              console.log('DEBUG - First requisition FULL:', JSON.stringify({
                id: firstReq.id,
                project_id: firstReq.project_id,
                number: firstReq.number,
                invoice_number: firstReq.invoice_number,
                status: firstReq.status,
                vendor_name: firstReq.vendor_name,
                // All possible amount fields
                total_claimed_amount: firstReq.total_claimed_amount,
                amount: firstReq.amount,
                total_amount: firstReq.total_amount,
                payment_due: firstReq.payment_due,
                net_amount: firstReq.net_amount,
                gross_amount: firstReq.gross_amount,
                invoice_total: firstReq.invoice_total,
                balance: firstReq.balance,
                current_payment_due: firstReq.current_payment_due,
                total_completed_and_stored_to_date: firstReq.total_completed_and_stored_to_date,
                total_completed_work_retainage_to_date: firstReq.total_completed_work_retainage_to_date,
                total_materials_presently_stored: firstReq.total_materials_presently_stored,
                g702_total_completed_and_stored_to_date: firstReq.g702_total_completed_and_stored_to_date,
                g702_total_earned_less_retainage: firstReq.g702_total_earned_less_retainage,
                total_retainage: firstReq.total_retainage,
                retainage_released_amount: firstReq.retainage_released_amount,
                total_retainage_currently_released: firstReq.total_retainage_currently_released,
                g702_current_payment_due: firstReq.g702_current_payment_due,
                work_completed_from_previous_application: firstReq.work_completed_from_previous_application,
                work_completed_this_period: firstReq.work_completed_this_period,
                materials_presently_stored: firstReq.materials_presently_stored,
              }, null, 2));

              // Also log a few more invoices to see the pattern
              if (filteredReqs.length > 1) {
                console.log('=== REQUISITION DEBUG (Invoice #2) ===');
                const secondReq = filteredReqs[1];
                console.log(JSON.stringify({
                  number: secondReq.number,
                  vendor_name: secondReq.vendor_name,
                  total_claimed_amount: secondReq.total_claimed_amount,
                  net_amount: secondReq.net_amount,
                  total_completed_and_stored_to_date: secondReq.total_completed_and_stored_to_date,
                  g702_current_payment_due: secondReq.g702_current_payment_due,
                  work_completed_this_period: secondReq.work_completed_this_period,
                }, null, 2));
              }
            }
            return filteredReqs;
          }),
          // Payment applications (billings to owner) - filter by prime contract IDs
          safeRequest(async () => {
            console.log('Fetching payment applications...');

            // Try v1.1 first
            let apps = await safeRequest(() =>
              fetchAllPages(`/rest/v1.1/payment_applications`, tokens, { company_id: companyId, project_id: projectId })
            );
            console.log(`Payment applications v1.1 returned ${apps?.length || 0} items`);

            // If v1.1 returns 0, try v1.0
            if (!apps || apps.length === 0) {
              console.log('Trying v1.0 payment_applications...');
              apps = await safeRequest(() =>
                fetchAllPages(`/rest/v1.0/payment_applications`, tokens, { company_id: companyId, project_id: projectId })
              );
              console.log(`Payment applications v1.0 returned ${apps?.length || 0} items`);
            }

            // Filter by prime contract ID (payment apps link to prime contracts, not projects directly)
            const filteredApps = (apps || []).filter((app: any) => {
              // Check multiple possible locations for the contract ID
              const contractId = String(app.prime_contract_id || app.contract_id || app.contract?.id || '');
              const appProjectId = app.project_id || app.contract?.project_id;

              // Match if contract ID is in our prime contracts OR if project_id matches
              return primeContractIds.has(contractId) || String(appProjectId) === String(projectId);
            });
            console.log(`Payment applications after filter: ${filteredApps.length} items`);

            if (filteredApps.length > 0) {
              console.log('DEBUG - First payment app:', JSON.stringify({
                id: filteredApps[0].id,
                prime_contract_id: filteredApps[0].prime_contract_id,
                contract_id: filteredApps[0].contract_id,
                project_id: filteredApps[0].project_id,
                number: filteredApps[0].number,
                status: filteredApps[0].status,
              }, null, 2));
            }
            return filteredApps;
          }),
          // Change orders
          safeRequest(async () => {
            // Commitment change orders (from subs)
            const commitmentCOs = await safeRequest(() => fetchAllPages(`/rest/v1.0/change_order_packages`, tokens, { company_id: companyId, project_id: projectId }));
            // Prime contract change orders (to owner)
            const primeCOs = await safeRequest(() => fetchAllPages(`/rest/v1.0/prime_contract/change_order_packages`, tokens, { company_id: companyId, project_id: projectId }));
            return { commitment: commitmentCOs, prime: primeCOs };
          }, { commitment: [], prime: [] }),
          // Direct costs (expenses not tied to commitments) - use path-based project endpoint
          safeRequest(() => fetchAllPages(`/rest/v1.0/projects/${projectId}/direct_costs`, tokens, { company_id: companyId })),
        ]);

        console.log(`Fetched ${subInvoices?.length || 0} requisitions (sub invoices)`);
        console.log(`Fetched ${paymentApplications?.length || 0} payment applications (owner invoices)`);

        result = {
          project,
          vendors,
          costCodes,
          commitments,
          budget,
          subInvoices,
          primeContract,
          paymentApplications,
          changeOrders,
          directCosts
        };
        break;

      case 'getEmails':
        if (!projectId) throw new Error('Project ID required');
        // Try Procore Correspondence/Emails endpoints
        result = await safeRequest(async () => {
          // Try /emails endpoint first (Procore Emails tool)
          let emails = await safeRequest(() =>
            fetchAllPages(`/rest/v1.0/projects/${projectId}/emails`, tokens, {
              company_id: companyId,
              sort: '-created_at',
              per_page: '10'
            }), []);

          // Fallback to /correspondence
          if (emails.length === 0) {
            emails = await safeRequest(() =>
              fetchAllPages(`/rest/v1.0/projects/${projectId}/correspondence`, tokens, {
                company_id: companyId,
                per_page: '10'
              }), []);
          }

          // Normalize to a consistent format
          return emails.map((e: any) => ({
            id: e.id,
            subject: e.subject || e.title || 'No subject',
            from_name: e.from?.name || e.author?.name || e.created_by?.name || 'Unknown',
            date: e.created_at ? new Date(e.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
            snippet: (e.body || e.rich_text_body || e.description || '').replace(/<[^>]*>/g, '').substring(0, 120),
          }));
        }, []);
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
