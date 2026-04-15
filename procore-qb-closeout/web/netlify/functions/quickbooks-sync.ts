import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://mctfnfczyznsecinspvi.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jdGZuZmN6eXpuc2VjaW5zcHZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTM2MjksImV4cCI6MjA5MTgyOTYyOX0.0uF7wtkT_4qUvLbXnacUijFVjXjEKhL3XComyQUPwXY';
const supabase = createClient(supabaseUrl, supabaseKey);

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
  const clientId = process.env.QBO_CLIENT_ID || 'ABenQKVtNNzyfGlYzpNUsu5CF3O8t9PzrQw2LnxcgpnHEVAe2F';
  const clientSecret = process.env.QBO_CLIENT_SECRET || 'e2TkJJWomPMvwcN0CfYfLHnPhaINK2WA9eiIXl0L';
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

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
    .eq('provider', 'quickbooks');

  return newTokens;
}

async function qboRequest(endpoint: string, tokens: TokenData, userId: string): Promise<any> {
  if (tokens.expires_at) {
    const timeLeft = new Date(tokens.expires_at).getTime() - Date.now();
    if (timeLeft < 30 * 60 * 1000) {
      const refreshed = await refreshAccessToken(tokens, userId);
      if (refreshed) tokens = refreshed;
    }
  }

  const url = `${QBO_BASE_URL}/v3/company/${tokens.realm_id}/${endpoint}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/json',
    },
  });

  const intuitTid = res.headers.get('intuit_tid');
  if (intuitTid) {
    console.log(`QB API [${endpoint}] intuit_tid: ${intuitTid}`);
  }

  if (res.status === 401) {
    console.log(`QB 401 error, intuit_tid: ${intuitTid || 'not provided'}`);
    const refreshed = await refreshAccessToken(tokens, userId);
    if (refreshed) return qboRequest(endpoint, refreshed, userId);
    throw new Error(`QB auth failed (intuit_tid: ${intuitTid || 'N/A'})`);
  }
  if (!res.ok) {
    const errBody = await res.text();
    console.error(`QB API error: ${res.status}, intuit_tid: ${intuitTid}, body: ${errBody}`);
    throw new Error(`QB API ${res.status} (intuit_tid: ${intuitTid || 'N/A'})`);
  }
  return res.json();
}

async function qboQuery(query: string, tokens: TokenData, userId: string): Promise<any> {
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
  const pageSize = 1000;

  while (true) {
    const query = `${baseQuery} STARTPOSITION ${startPos} MAXRESULTS ${pageSize}`;
    const response = await qboQuery(query, tokens, userId);
    const entities = response[entityName] || [];

    if (entities.length === 0) break;
    allData.push(...entities);
    if (entities.length < pageSize) break;
    startPos += pageSize;
  }

  return allData;
}

function getAgingBucket(daysPastDue: number): string {
  if (daysPastDue <= 0) return 'Current';
  if (daysPastDue <= 30) return '1-30 Days';
  if (daysPastDue <= 60) return '31-60 Days';
  if (daysPastDue <= 90) return '61-90 Days';
  return '90+ Days';
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

    const tokens = await getStoredTokens(userId);
    if (!tokens) return { statusCode: 401, headers, body: JSON.stringify({ error: 'QuickBooks not connected' }) };

    const now = new Date();
    let arCount = 0, apCount = 0, bankCount = 0;

    // --- Fetch ALL invoices and bills with pagination, plus bank accounts ---
    const [invoices, bills, accountRes] = await Promise.all([
      paginatedQuery('SELECT * FROM Invoice', 'Invoice', tokens, userId),
      paginatedQuery('SELECT * FROM Bill', 'Bill', tokens, userId),
      qboQuery("SELECT * FROM Account WHERE AccountType = 'Bank' AND Active = true MAXRESULTS 50", tokens, userId),
    ]);

    const bankAccounts = accountRes.Account || [];
    console.log(`QB fetched: ${invoices.length} invoices, ${bills.length} bills, ${bankAccounts.length} bank accounts`);

    // --- Process AR (Invoices) ---
    await supabase.from('qb_ar_aging').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    const arRows = invoices.map((inv: any) => {
      const dueDate = inv.DueDate || inv.TxnDate;
      const dueDateObj = new Date(dueDate);
      const daysPastDue = Math.max(0, Math.floor((now.getTime() - dueDateObj.getTime()) / (1000 * 60 * 60 * 24)));
      return {
        customer_name: inv.CustomerRef?.name || 'Unknown Customer',
        invoice_number: inv.DocNumber || String(inv.Id),
        amount: inv.TotalAmt || inv.Balance || 0,
        due_date: dueDate,
        aging_bucket: getAgingBucket(daysPastDue),
        days_past_due: daysPastDue,
      };
    });

    // Batch insert in chunks of 500
    for (let i = 0; i < arRows.length; i += 500) {
      const chunk = arRows.slice(i, i + 500);
      const { error } = await supabase.from('qb_ar_aging').insert(chunk);
      if (!error) arCount += chunk.length;
      else console.error('AR insert error:', error.message);
    }

    // --- Process AP (Bills) ---
    await supabase.from('qb_ap_aging').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    const apRows = bills.map((bill: any) => {
      const dueDate = bill.DueDate || bill.TxnDate;
      const dueDateObj = new Date(dueDate);
      const daysPastDue = Math.max(0, Math.floor((now.getTime() - dueDateObj.getTime()) / (1000 * 60 * 60 * 24)));
      return {
        vendor_name: bill.VendorRef?.name || 'Unknown Vendor',
        bill_number: bill.DocNumber || String(bill.Id),
        amount: bill.TotalAmt || bill.Balance || 0,
        due_date: dueDate,
        aging_bucket: getAgingBucket(daysPastDue),
        days_past_due: daysPastDue,
      };
    });

    for (let i = 0; i < apRows.length; i += 500) {
      const chunk = apRows.slice(i, i + 500);
      const { error } = await supabase.from('qb_ap_aging').insert(chunk);
      if (!error) apCount += chunk.length;
      else console.error('AP insert error:', error.message);
    }

    // --- Process Bank Balances ---
    await supabase.from('qb_bank_balances').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    const bankRows = bankAccounts.map((acct: any) => ({
      account_name: acct.Name || acct.FullyQualifiedName || 'Unknown Account',
      current_balance: acct.CurrentBalance || 0,
      as_of_date: now.toISOString().split('T')[0],
    }));

    const { error: bankErr } = await supabase.from('qb_bank_balances').insert(bankRows);
    if (!bankErr) bankCount = bankRows.length;
    else console.error('Bank insert error:', bankErr.message);

    console.log(`QB Sync: ${arCount} AR, ${apCount} AP, ${bankCount} bank accounts`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        synced: {
          ar_invoices: arCount,
          ap_bills: apCount,
          bank_accounts: bankCount,
        },
      }),
    };
  } catch (error: any) {
    console.error('QB Sync error:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
