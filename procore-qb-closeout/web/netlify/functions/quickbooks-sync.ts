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
  const clientId = process.env.QBO_CLIENT_ID || 'ABE01lFAdrTOVwsFkI5YwJoUPD1OpG8pwMbW9FEGjVf4bgT6Y7';
  const clientSecret = process.env.QBO_CLIENT_SECRET || 'BIugIZAZB4R4o49eSvqQFIEBi6S2rnn3K5jhXfqZ';
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

  if (res.status === 401) {
    const refreshed = await refreshAccessToken(tokens, userId);
    if (refreshed) return qboRequest(endpoint, refreshed, userId);
    throw new Error('QB auth failed');
  }
  if (!res.ok) throw new Error(`QB API ${res.status}`);
  return res.json();
}

async function qboQuery(query: string, tokens: TokenData, userId: string): Promise<any> {
  const encoded = encodeURIComponent(query);
  const response = await qboRequest(`query?query=${encoded}`, tokens, userId);
  return response.QueryResponse || {};
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

    // --- Fetch open invoices (AR) and unpaid bills (AP) in parallel ---
    const [invoiceRes, billRes, accountRes] = await Promise.all([
      qboQuery("SELECT * FROM Invoice WHERE Balance != '0' MAXRESULTS 100", tokens, userId),
      qboQuery("SELECT * FROM Bill WHERE Balance != '0' MAXRESULTS 100", tokens, userId),
      qboQuery("SELECT * FROM Account WHERE AccountType = 'Bank' AND Active = true MAXRESULTS 20", tokens, userId),
    ]);

    const invoices = invoiceRes.Invoice || [];
    const bills = billRes.Bill || [];
    const bankAccounts = accountRes.Account || [];

    // --- Process AR (Invoices) ---
    // Clear old AR data for this sync
    await supabase.from('qb_ar_aging').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    for (const inv of invoices) {
      const dueDate = inv.DueDate || inv.TxnDate;
      const dueDateObj = new Date(dueDate);
      const daysPastDue = Math.max(0, Math.floor((now.getTime() - dueDateObj.getTime()) / (1000 * 60 * 60 * 24)));

      const { error } = await supabase.from('qb_ar_aging').insert({
        customer_name: inv.CustomerRef?.name || 'Unknown Customer',
        invoice_number: inv.DocNumber || String(inv.Id),
        amount: inv.Balance || 0,
        due_date: dueDate,
        aging_bucket: getAgingBucket(daysPastDue),
        days_past_due: daysPastDue,
      });
      if (!error) arCount++;
    }

    // --- Process AP (Bills) ---
    await supabase.from('qb_ap_aging').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    for (const bill of bills) {
      const dueDate = bill.DueDate || bill.TxnDate;
      const dueDateObj = new Date(dueDate);
      const daysPastDue = Math.max(0, Math.floor((now.getTime() - dueDateObj.getTime()) / (1000 * 60 * 60 * 24)));

      const { error } = await supabase.from('qb_ap_aging').insert({
        vendor_name: bill.VendorRef?.name || 'Unknown Vendor',
        bill_number: bill.DocNumber || String(bill.Id),
        amount: bill.Balance || 0,
        due_date: dueDate,
        aging_bucket: getAgingBucket(daysPastDue),
        days_past_due: daysPastDue,
      });
      if (!error) apCount++;
    }

    // --- Process Bank Balances ---
    await supabase.from('qb_bank_balances').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    for (const acct of bankAccounts) {
      const { error } = await supabase.from('qb_bank_balances').insert({
        account_name: acct.Name || acct.FullyQualifiedName || 'Unknown Account',
        current_balance: acct.CurrentBalance || 0,
        as_of_date: now.toISOString().split('T')[0],
      });
      if (!error) bankCount++;
    }

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
