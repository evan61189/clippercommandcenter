import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// Use env vars with hardcoded fallback for Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://mctfnfczyznsecinspvi.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jdGZuZmN6eXpuc2VjaW5zcHZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTM2MjksImV4cCI6MjA5MTgyOTYyOX0.0uF7wtkT_4qUvLbXnacUijFVjXjEKhL3XComyQUPwXY';
const supabase = createClient(supabaseUrl, supabaseKey);

// QuickBooks API base URL
const QBO_BASE_URL = 'https://quickbooks.api.intuit.com';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

interface TokenData {
  access_token: string;
  refresh_token: string;
  realm_id: string;
  expires_at?: string;
}

async function getStoredTokens(userId: string): Promise<TokenData | null> {
  const { data, error } = await supabase
    .from('api_credentials')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'quickbooks')
    .single();

  if (error || !data) return null;
  return data.credentials as TokenData;
}

async function refreshAccessToken(tokens: TokenData, userId: string): Promise<TokenData | null> {
  // Hardcoded QuickBooks credentials as fallback
  const clientId = process.env.QBO_CLIENT_ID || 'ABE01lFAdrTOVwsFkI5YwJoUPD1OpG8pwMbW9FEGjVf4bgT6Y7';
  const clientSecret = process.env.QBO_CLIENT_SECRET || 'BIugIZAZB4R4o49eSvqQFIEBi6S2rnn3K5jhXfqZ';

  if (!clientId || !clientSecret) {
    console.error('QuickBooks client credentials not configured');
    return null;
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  console.log('Attempting QuickBooks token refresh...');

  const response = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`QuickBooks token refresh failed: ${response.status}`, errorBody);
    // If refresh token is invalid/expired, user needs to reconnect
    if (response.status === 400 || response.status === 401) {
      console.error('QuickBooks refresh token expired - user must reconnect');
    }
    return null;
  }

  const data = await response.json();
  console.log('QuickBooks token refresh successful');

  const newTokens: TokenData = {
    ...tokens,
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };

  // Update stored tokens
  await supabase
    .from('api_credentials')
    .update({ credentials: newTokens, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('provider', 'quickbooks');

  return newTokens;
}

async function qboRequest(
  endpoint: string,
  tokens: TokenData,
  userId: string
): Promise<any> {
  // Proactive token refresh - check if token expires in less than 30 minutes
  // This keeps the refresh token active and prevents expiration from non-use
  if (tokens.expires_at) {
    const expiresAt = new Date(tokens.expires_at);
    const now = new Date();
    const timeUntilExpiry = expiresAt.getTime() - now.getTime();
    if (timeUntilExpiry < 30 * 60 * 1000) {
      console.log(`QuickBooks token expiring in ${Math.round(timeUntilExpiry / 60000)} minutes, refreshing proactively...`);
      const newTokens = await refreshAccessToken(tokens, userId);
      if (newTokens) {
        tokens = newTokens;
      }
    }
  }

  const url = `${QBO_BASE_URL}/v3/company/${tokens.realm_id}/${endpoint}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  // Capture intuit_tid for debugging and support
  const intuitTid = response.headers.get('intuit_tid');
  if (intuitTid) {
    console.log(`QuickBooks API [${endpoint}] intuit_tid: ${intuitTid}`);
  }

  if (response.status === 401) {
    // Token expired, try to refresh
    console.log(`QuickBooks 401 error, intuit_tid: ${intuitTid || 'not provided'}`);
    const newTokens = await refreshAccessToken(tokens, userId);
    if (newTokens) {
      return qboRequest(endpoint, newTokens, userId);
    }
    throw new Error(`Authentication failed (intuit_tid: ${intuitTid || 'N/A'})`);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`QuickBooks API error: ${response.status}, intuit_tid: ${intuitTid}, body: ${errorBody}`);
    throw new Error(`QuickBooks API error: ${response.status} (intuit_tid: ${intuitTid || 'N/A'})`);
  }

  return response.json();
}

async function qboQuery(
  query: string,
  tokens: TokenData,
  userId: string
): Promise<any[]> {
  const encoded = encodeURIComponent(query);
  const response = await qboRequest(`query?query=${encoded}`, tokens, userId);
  return response.QueryResponse || {};
}

async function paginatedQuery(
  baseQuery: string,
  entityName: string,
  tokens: TokenData,
  userId: string
): Promise<any[]> {
  const allData: any[] = [];
  let startPos = 1;
  const maxResults = 1000;

  while (true) {
    const query = `${baseQuery} STARTPOSITION ${startPos} MAXRESULTS ${maxResults}`;
    const response = await qboQuery(query, tokens, userId);
    const entities = response[entityName] || [];

    if (entities.length === 0) break;
    allData.push(...entities);
    if (entities.length < maxResults) break;
    startPos += maxResults;
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
    const { action, userId, projectName } = JSON.parse(event.body || '{}');

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
        body: JSON.stringify({ error: 'QuickBooks not connected. Please connect in Settings.' }),
      };
    }

    let result: any;

    switch (action) {
      case 'getCompanyInfo':
        const companyResponse = await qboRequest(`companyinfo/${tokens.realm_id}`, tokens, userId);
        result = companyResponse.CompanyInfo;
        break;

      case 'getVendors':
        result = await paginatedQuery(
          'SELECT * FROM Vendor WHERE Active = true',
          'Vendor',
          tokens,
          userId
        );
        break;

      case 'getAccounts':
        result = await paginatedQuery(
          "SELECT * FROM Account WHERE Active = true AND AccountType IN ('Expense', 'Cost of Goods Sold')",
          'Account',
          tokens,
          userId
        );
        break;

      case 'getBills':
        result = await paginatedQuery('SELECT * FROM Bill', 'Bill', tokens, userId);
        break;

      case 'getBillPayments':
        result = await paginatedQuery('SELECT * FROM BillPayment', 'BillPayment', tokens, userId);
        break;

      case 'getCustomers':
        result = await paginatedQuery(
          'SELECT * FROM Customer WHERE Active = true',
          'Customer',
          tokens,
          userId
        );
        break;

      case 'getInvoices':
        // Customer invoices (what they owe us - AR)
        result = await paginatedQuery('SELECT * FROM Invoice', 'Invoice', tokens, userId);
        break;

      case 'getPaymentsReceived':
        // Payments received from customers
        result = await paginatedQuery('SELECT * FROM Payment', 'Payment', tokens, userId);
        break;

      case 'getFullData':
        console.log('Fetching full QuickBooks data...');
        const [
          companyInfo,
          vendors,
          accounts,
          bills,
          billPayments,
          customers,
          invoices,
          paymentsReceived
        ] = await Promise.all([
          qboRequest(`companyinfo/${tokens.realm_id}`, tokens, userId).then(r => r.CompanyInfo),
          paginatedQuery('SELECT * FROM Vendor WHERE Active = true', 'Vendor', tokens, userId),
          paginatedQuery(
            "SELECT * FROM Account WHERE Active = true AND AccountType IN ('Expense', 'Cost of Goods Sold')",
            'Account',
            tokens,
            userId
          ),
          // Bills (what we owe vendors - AP)
          paginatedQuery('SELECT * FROM Bill', 'Bill', tokens, userId),
          // Payments to vendors
          paginatedQuery('SELECT * FROM BillPayment', 'BillPayment', tokens, userId),
          paginatedQuery('SELECT * FROM Customer WHERE Active = true', 'Customer', tokens, userId),
          // Invoices to customers (what they owe us - AR)
          paginatedQuery('SELECT * FROM Invoice', 'Invoice', tokens, userId),
          // Payments received from customers
          paginatedQuery('SELECT * FROM Payment', 'Payment', tokens, userId),
        ]);
        console.log(`QB Data: ${vendors.length} vendors, ${bills.length} bills, ${invoices.length} invoices`);
        result = {
          companyInfo,
          vendors,
          accounts,
          bills,
          billPayments,
          customers,
          invoices,
          paymentsReceived
        };
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
    console.error('QuickBooks API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};
