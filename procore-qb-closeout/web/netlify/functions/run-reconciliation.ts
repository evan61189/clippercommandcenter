import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// Use env vars with hardcoded fallback for Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://eruvdljuqvvoxfnlraje.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVydXZkbGp1cXZ2b3hmbmxyYWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNTc5ODksImV4cCI6MjA4NTgzMzk4OX0.JeR6g6NJa7c9yohW19OWlS-EMKg650Jwf4WYXYQGBhU';
const supabase = createClient(supabaseUrl, supabaseKey);

// Anthropic API for AI analysis
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// QuickBooks API configuration
const QBO_BASE_URL = 'https://quickbooks.api.intuit.com';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

interface QBTokenData {
  access_token: string;
  refresh_token: string;
  realm_id: string;
  expires_at?: string;
}

async function getQBTokens(userId: string): Promise<QBTokenData | null> {
  const { data, error } = await supabase
    .from('api_credentials')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'quickbooks')
    .single();

  if (error || !data) return null;
  return data.credentials as QBTokenData;
}

async function refreshQBToken(tokens: QBTokenData, userId: string): Promise<QBTokenData | null> {
  const clientId = process.env.QBO_CLIENT_ID || 'ABgPHajheBYc4ajSSov1P8b8emmalTPmmw5uAn99gUcfg2bOo9';
  const clientSecret = process.env.QBO_CLIENT_SECRET || 'pDqaEgsPkyKf9hNmN9p5wfeVIKBLIFRLz1yNOfX9';

  if (!clientId || !clientSecret) return null;

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
  const newTokens: QBTokenData = {
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

async function qbRequest(endpoint: string, tokens: QBTokenData, userId: string): Promise<any> {
  // Proactive token refresh
  if (tokens.expires_at) {
    const expiresAt = new Date(tokens.expires_at);
    const now = new Date();
    if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
      const newTokens = await refreshQBToken(tokens, userId);
      if (newTokens) tokens = newTokens;
    }
  }

  const url = `${QBO_BASE_URL}/v3/company/${tokens.realm_id}/${endpoint}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: 'application/json',
    },
  });

  if (response.status === 401) {
    const newTokens = await refreshQBToken(tokens, userId);
    if (newTokens) {
      return qbRequest(endpoint, newTokens, userId);
    }
    throw new Error('QuickBooks authentication failed');
  }

  if (!response.ok) {
    throw new Error(`QuickBooks API error: ${response.status}`);
  }

  return response.json();
}

async function qbQuery(query: string, tokens: QBTokenData, userId: string): Promise<any> {
  const encoded = encodeURIComponent(query);
  const response = await qbRequest(`query?query=${encoded}`, tokens, userId);
  return response.QueryResponse || {};
}

async function paginatedQBQuery(baseQuery: string, entityName: string, tokens: QBTokenData, userId: string): Promise<any[]> {
  const allData: any[] = [];
  let startPos = 1;
  const maxResults = 1000;

  while (true) {
    const query = `${baseQuery} STARTPOSITION ${startPos} MAXRESULTS ${maxResults}`;
    const response = await qbQuery(query, tokens, userId);
    const entities = response[entityName] || [];

    if (entities.length === 0) break;
    allData.push(...entities);
    if (entities.length < maxResults) break;
    startPos += maxResults;
  }

  return allData;
}

// Fetch only QB vendors (first step in targeted approach)
async function fetchQBVendors(userId: string): Promise<{ vendors: any[]; tokens: QBTokenData }> {
  console.log('Getting QB tokens for userId:', userId);
  const tokens = await getQBTokens(userId);
  if (!tokens) {
    console.error('No QB tokens found for userId:', userId);
    throw new Error('QuickBooks not connected. Please connect in Settings.');
  }
  console.log('QB tokens found, realm_id:', tokens.realm_id);

  console.log('Fetching QuickBooks vendors...');
  const vendors = await paginatedQBQuery('SELECT * FROM Vendor WHERE Active = true', 'Vendor', tokens, userId);
  console.log(`QB Vendors fetched: ${vendors.length}`);

  return { vendors, tokens };
}

// Fetch QB bills only for specific vendor IDs (project vendors)
async function fetchQBBillsForVendors(
  vendorIds: string[],
  tokens: QBTokenData,
  userId: string
): Promise<any[]> {
  if (vendorIds.length === 0) {
    console.log('No vendor IDs to fetch bills for');
    return [];
  }

  console.log(`Fetching QB bills for ${vendorIds.length} project vendors...`);

  // QuickBooks doesn't support IN clause for VendorRef, so we need to fetch all bills
  // and filter. But we can still optimize by only processing relevant bills in memory.
  // If there are very few vendors, we could do multiple queries with OR.

  let vendorBills: any[];
  if (vendorIds.length <= 10) {
    // For small number of vendors, use OR queries
    const vendorConditions = vendorIds.map(id => `VendorRef = '${id}'`).join(' OR ');
    const query = `SELECT * FROM Bill WHERE ${vendorConditions}`;
    console.log('Using targeted bill query for', vendorIds.length, 'vendors');
    vendorBills = await paginatedQBQuery(query, 'Bill', tokens, userId);
  } else {
    // For larger number of vendors, fetch all bills and filter in memory
    console.log('Fetching all bills and filtering for', vendorIds.length, 'project vendors');
    const allBills = await paginatedQBQuery('SELECT * FROM Bill', 'Bill', tokens, userId);
    const vendorIdSet = new Set(vendorIds);
    vendorBills = allBills.filter((bill: any) => {
      const billVendorId = bill.VendorRef?.value;
      return billVendorId && vendorIdSet.has(String(billVendorId));
    });
    console.log(`Filtered ${allBills.length} bills down to ${vendorBills.length} for project vendors`);
  }

  // Don't pre-filter by amount - let matching algorithm determine matches
  // User can then manually match unmatched items sorted by vendor
  console.log(`Found ${vendorBills.length} bills for project vendors`);
  return vendorBills;
}

// Fetch other QB data (invoices, payments) - filtered by project customer
async function fetchQBInvoicesAndPayments(
  tokens: QBTokenData,
  userId: string,
  projectName: string
): Promise<{ invoices: any[]; paymentsReceived: any[]; matchedCustomer: string | null }> {
  console.log('Fetching QB customers to find project match...');

  // First fetch all customers to find the best match for the project
  const customers = await paginatedQBQuery('SELECT * FROM Customer WHERE Active = true', 'Customer', tokens, userId);
  console.log(`Found ${customers.length} QB customers`);

  // Find best matching customer for this project (require higher threshold)
  let bestCustomer: { Id: string; DisplayName: string; score: number } | null = null;
  for (const customer of customers) {
    const customerName = customer.DisplayName || customer.FullyQualifiedName || '';
    const score = fuzzyMatch(projectName, customerName);
    // Require at least 70% match for customer selection
    if (score >= 70 && (!bestCustomer || score > bestCustomer.score)) {
      bestCustomer = { Id: customer.Id, DisplayName: customerName, score };
    }
  }

  if (bestCustomer) {
    console.log(`Matched project "${projectName}" to QB customer "${bestCustomer.DisplayName}" (score: ${bestCustomer.score})`);

    // Fetch ALL invoices for this customer (don't filter by amount - we want to catch discrepancies)
    const invoices = await paginatedQBQuery(
      `SELECT * FROM Invoice WHERE CustomerRef = '${bestCustomer.Id}'`,
      'Invoice',
      tokens,
      userId
    );
    console.log(`Found ${invoices.length} invoices for customer "${bestCustomer.DisplayName}"`);

    // Fetch payments for this customer
    const paymentsReceived = await paginatedQBQuery(
      `SELECT * FROM Payment WHERE CustomerRef = '${bestCustomer.Id}'`,
      'Payment',
      tokens,
      userId
    );
    console.log(`Found ${paymentsReceived.length} payments for customer "${bestCustomer.DisplayName}"`);

    return { invoices, paymentsReceived, matchedCustomer: bestCustomer.DisplayName };
  } else {
    console.log(`No matching QB customer found for project "${projectName}"`);
    return { invoices: [], paymentsReceived: [], matchedCustomer: null };
  }
}

// ============== Type Definitions ==============

interface ProcoreCommitment {
  id: string;
  vendor: string;
  vendorId?: string;
  type: 'subcontract' | 'purchase_order';
  number: string;
  title: string;
  status: string;
  originalAmount: number;
  approvedChanges: number;
  pendingChanges: number;
  currentValue: number;
  billedToDate: number;
  paidToDate: number;
  retentionHeld: number;
}

interface ProcoreInvoice {
  id: string;
  commitmentId?: string;
  vendor: string;
  number: string;
  status: string;
  amount: number;
  billingDate: string;
  paymentDue: number;
}

interface ProcorePaymentApp {
  id: string;
  number: string;
  status: string;
  billingDate: string;
  totalAmount: number;
  approvedAmount: number;
}

interface ProcoreDirectCost {
  id: string;
  vendor?: string;
  description: string;
  invoiceNumber?: string;
  amount: number;
  date: string;
  status: string;
}

interface QBBill {
  id: string;
  vendor: string;
  vendorId: string;
  docNumber: string;
  amount: number;
  balance: number;
  date: string;
  dueDate?: string;
  memo?: string;
}

interface QBBillPayment {
  id: string;
  vendor: string;
  vendorId: string;
  amount: number;
  date: string;
  billIds: string[];
}

interface QBInvoice {
  id: string;
  customer: string;
  customerId: string;
  docNumber: string;
  amount: number;
  balance: number;
  date: string;
  dueDate?: string;
}

interface QBPayment {
  id: string;
  customer: string;
  customerId: string;
  amount: number;
  date: string;
  invoiceIds: string[];
}

interface MatchResult {
  id: string;
  matchType: 'invoice' | 'payment_app' | 'direct_cost' | 'commitment' | 'vendor_total';
  category: 'accounts_payable' | 'accounts_receivable' | 'direct_cost';
  description: string;
  vendor: string | null;
  customer: string | null;
  procoreRef: string | null;
  qbRef: string | null;
  procoreValue: number | null;
  qbValue: number | null;
  variance: number;
  variancePct: number;
  matchConfidence: number; // 0-100
  matchMethod: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'matched' | 'partial' | 'unmatched_procore' | 'unmatched_qb' | 'timing';
  notes: string;
  procoreDate?: string;
  qbDate?: string;
  requiresAction: boolean;
}

interface CloseoutItem {
  itemId: string;
  category: string;
  description: string;
  vendor: string | null;
  amountAtRisk: number;
  actionRequired: string;
  priority: number;
  dueDate?: string;
}

// ============== Utility Functions ==============

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function normalizeString(str: string | number | undefined | null): string {
  if (str === null || str === undefined) return '';
  return String(str).toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

function fuzzyMatch(str1: string, str2: string): number {
  const s1 = normalizeString(str1);
  const s2 = normalizeString(str2);

  if (s1 === s2) return 100;
  if (s1.includes(s2) || s2.includes(s1)) return 85;

  // Word-based matching
  const words1 = new Set(str1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(str2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const intersection = [...words1].filter(w => words2.has(w));
  const union = new Set([...words1, ...words2]);

  if (union.size === 0) return 0;
  const wordScore = Math.round((intersection.length / union.size) * 100);

  // Levenshtein-like similarity for short strings
  if (s1.length < 20 && s2.length < 20) {
    let matches = 0;
    const shorter = s1.length < s2.length ? s1 : s2;
    const longer = s1.length < s2.length ? s2 : s1;
    for (let i = 0; i < shorter.length; i++) {
      if (longer.includes(shorter[i])) matches++;
    }
    const charScore = Math.round((matches / longer.length) * 100);
    return Math.max(wordScore, charScore);
  }

  return wordScore;
}

function amountMatches(amount1: number, amount2: number, tolerance: number = 0.01): boolean {
  if (amount1 === 0 && amount2 === 0) return true;
  const diff = Math.abs(amount1 - amount2);
  const maxAmount = Math.max(Math.abs(amount1), Math.abs(amount2));
  return diff <= tolerance * maxAmount || diff < 1; // Within tolerance or less than $1
}

function dateWithinDays(date1: string, date2: string, days: number): boolean {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffMs = Math.abs(d1.getTime() - d2.getTime());
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= days;
}

function calculateSeverity(variance: number, baseAmount: number): 'info' | 'warning' | 'critical' {
  const absVariance = Math.abs(variance);
  const pct = baseAmount ? Math.abs(variance / baseAmount) : 0;

  if (absVariance >= 5000 || pct >= 0.10) return 'critical';
  if (absVariance >= 500 || pct >= 0.02) return 'warning';
  return 'info';
}

// ============== Data Normalization ==============

function normalizeCommitments(procoreData: any): ProcoreCommitment[] {
  const commitments: ProcoreCommitment[] = [];

  // Debug: Log first subcontract to see structure
  const firstSub = procoreData.commitments?.subcontracts?.[0];
  if (firstSub) {
    console.log('Sample subcontract structure:', JSON.stringify({
      id: firstSub.id,
      vendor: firstSub.vendor,
      contract_company: firstSub.contract_company,
      contractor: firstSub.contractor,
      company: firstSub.company,
      // Check all top-level keys
      keys: Object.keys(firstSub).slice(0, 20)
    }, null, 2));
  }

  // Process subcontracts
  for (const sub of procoreData.commitments?.subcontracts || []) {
    // Try multiple possible vendor name locations
    // Procore uses vendor.company for the company name
    const vendorName = sub.vendor?.company
      || sub.vendor?.name
      || sub.contract_company?.name
      || sub.contractor?.name
      || sub.company?.name
      || (typeof sub.vendor === 'string' ? sub.vendor : null)
      || (typeof sub.contract_company === 'string' ? sub.contract_company : null)
      || 'Unknown Vendor';

    commitments.push({
      id: String(sub.id),
      vendor: vendorName,
      vendorId: String(sub.vendor?.id || sub.contract_company?.id || ''),
      type: 'subcontract',
      number: sub.number || '',
      title: sub.title || '',
      status: sub.status || '',
      originalAmount: parseFloat(sub.grand_total || sub.original_value || 0),
      approvedChanges: parseFloat(sub.approved_change_orders || sub.change_order_approved_amount || 0),
      pendingChanges: parseFloat(sub.pending_change_orders || sub.change_order_pending_amount || 0),
      currentValue: parseFloat(sub.revised_value || sub.grand_total || 0),
      billedToDate: parseFloat(sub.invoiced_amount || sub.bill_amount || 0),
      paidToDate: parseFloat(sub.payment_amount || sub.paid_amount || 0),
      retentionHeld: parseFloat(sub.retention_amount || sub.held_retention || 0),
    });
  }

  // Process purchase orders
  for (const po of procoreData.commitments?.purchaseOrders || []) {
    // Procore uses vendor.company for the company name
    const poVendorName = po.vendor?.company
      || po.vendor?.name
      || po.contract_company?.name
      || po.contractor?.name
      || po.company?.name
      || (typeof po.vendor === 'string' ? po.vendor : null)
      || 'Unknown Vendor';

    commitments.push({
      id: String(po.id),
      vendor: poVendorName,
      vendorId: String(po.vendor?.id || po.contract_company?.id || ''),
      type: 'purchase_order',
      number: po.number || '',
      title: po.title || '',
      status: po.status || '',
      originalAmount: parseFloat(po.grand_total || po.original_value || 0),
      approvedChanges: parseFloat(po.approved_change_orders || 0),
      pendingChanges: parseFloat(po.pending_change_orders || 0),
      currentValue: parseFloat(po.revised_value || po.grand_total || 0),
      billedToDate: parseFloat(po.invoiced_amount || po.bill_amount || 0),
      paidToDate: parseFloat(po.payment_amount || po.paid_amount || 0),
      retentionHeld: 0,
    });
  }

  return commitments;
}

function normalizeProcoreInvoices(procoreData: any): ProcoreInvoice[] {
  const invoices: ProcoreInvoice[] = [];

  // Debug: Log first invoice to see structure
  const firstInv = procoreData.subInvoices?.[0];
  if (firstInv) {
    console.log('Sample invoice structure:', JSON.stringify({
      id: firstInv.id,
      vendor: firstInv.vendor,
      origin_data: firstInv.origin_data,
      contract: firstInv.contract,
      commitment: firstInv.commitment,
      keys: Object.keys(firstInv).slice(0, 20)
    }, null, 2));
  }

  for (const inv of procoreData.subInvoices || []) {
    // Try multiple possible vendor name locations
    // Procore uses vendor_name as a top-level field on invoices
    const vendorName = inv.vendor_name
      || inv.vendor?.company
      || inv.vendor?.name
      || inv.origin_data?.vendor_name
      || inv.contract?.vendor?.name
      || inv.commitment?.vendor?.name
      || (typeof inv.vendor === 'string' ? inv.vendor : null)
      || 'Unknown';

    invoices.push({
      id: String(inv.id),
      commitmentId: String(inv.contract_id || inv.commitment_id || ''),
      vendor: vendorName,
      number: inv.number || inv.invoice_number || '',
      status: inv.status || '',
      // v1.1 API uses total_claimed_amount for requisitions
      amount: parseFloat(inv.total_claimed_amount || inv.amount || inv.total_amount || inv.payment_due || 0),
      billingDate: inv.billing_date || inv.invoice_date || '',
      paymentDue: parseFloat(inv.payment_due || inv.balance || 0),
    });
  }

  return invoices;
}

function normalizePaymentApps(procoreData: any): ProcorePaymentApp[] {
  const apps: ProcorePaymentApp[] = [];

  for (const app of procoreData.paymentApplications || []) {
    // v1.0 API uses total_amount_accrued_this_period or total_amount_paid for payment applications
    const totalAmt = parseFloat(
      app.total_amount_accrued_this_period ||
      app.total_amount_paid ||
      app.total_claimed_amount ||
      app.total_amount ||
      app.contract?.grand_total ||
      0
    );

    apps.push({
      id: String(app.id),
      number: app.number || String(app.id),
      status: app.status || '',
      billingDate: app.billing_date || '',
      totalAmount: totalAmt,
      approvedAmount: parseFloat(app.approved_amount || totalAmt || 0),
    });
  }

  return apps;
}

function normalizeDirectCosts(procoreData: any): ProcoreDirectCost[] {
  const costs: ProcoreDirectCost[] = [];

  for (const dc of procoreData.directCosts || []) {
    costs.push({
      id: String(dc.id),
      vendor: dc.vendor?.name || '',
      description: dc.description || '',
      invoiceNumber: dc.invoice_number || '',
      amount: parseFloat(dc.amount || dc.total_amount || 0),
      date: dc.direct_cost_date || dc.date || '',
      status: dc.status || '',
    });
  }

  return costs;
}

function normalizeQBBills(qbData: any): QBBill[] {
  return (qbData.bills || []).map((bill: any) => ({
    id: String(bill.Id),
    vendor: bill.VendorRef?.name || 'Unknown',
    vendorId: String(bill.VendorRef?.value || ''),
    docNumber: bill.DocNumber || '',
    amount: parseFloat(bill.TotalAmt || 0),
    balance: parseFloat(bill.Balance || 0),
    date: bill.TxnDate || '',
    dueDate: bill.DueDate || '',
    memo: bill.PrivateNote || bill.Memo || '',
  }));
}

function normalizeQBBillPayments(qbData: any): QBBillPayment[] {
  return (qbData.billPayments || []).map((pmt: any) => {
    const billIds: string[] = [];
    for (const line of pmt.Line || []) {
      if (line.LinkedTxn) {
        for (const linked of line.LinkedTxn) {
          if (linked.TxnType === 'Bill') {
            billIds.push(String(linked.TxnId));
          }
        }
      }
    }
    return {
      id: String(pmt.Id),
      vendor: pmt.VendorRef?.name || 'Unknown',
      vendorId: String(pmt.VendorRef?.value || ''),
      amount: parseFloat(pmt.TotalAmt || 0),
      date: pmt.TxnDate || '',
      billIds,
    };
  });
}

function normalizeQBInvoices(qbData: any): QBInvoice[] {
  return (qbData.invoices || []).map((inv: any) => ({
    id: String(inv.Id),
    customer: inv.CustomerRef?.name || 'Unknown',
    customerId: String(inv.CustomerRef?.value || ''),
    docNumber: inv.DocNumber || '',
    amount: parseFloat(inv.TotalAmt || 0),
    balance: parseFloat(inv.Balance || 0),
    date: inv.TxnDate || '',
    dueDate: inv.DueDate || '',
  }));
}

function normalizeQBPayments(qbData: any): QBPayment[] {
  return (qbData.paymentsReceived || []).map((pmt: any) => {
    const invoiceIds: string[] = [];
    for (const line of pmt.Line || []) {
      if (line.LinkedTxn) {
        for (const linked of line.LinkedTxn) {
          if (linked.TxnType === 'Invoice') {
            invoiceIds.push(String(linked.TxnId));
          }
        }
      }
    }
    return {
      id: String(pmt.Id),
      customer: pmt.CustomerRef?.name || 'Unknown',
      customerId: String(pmt.CustomerRef?.value || ''),
      amount: parseFloat(pmt.TotalAmt || 0),
      date: pmt.TxnDate || '',
      invoiceIds,
    };
  });
}

// ============== Matching Functions ==============

function findBestVendorMatch(
  procoreVendor: string,
  qbVendors: { DisplayName: string; Id: string }[]
): { name: string; id: string; score: number } | null {
  let best: { name: string; id: string; score: number } | null = null;

  for (const qbVendor of qbVendors) {
    const score = fuzzyMatch(procoreVendor, qbVendor.DisplayName);
    if (score >= 65 && (!best || score > best.score)) {
      best = { name: qbVendor.DisplayName, id: qbVendor.Id, score };
    }
  }

  return best;
}

// AI-powered vendor matching using Claude
async function matchVendorsWithAI(
  procoreVendors: string[],
  qbVendors: { DisplayName: string; Id: string }[]
): Promise<Map<string, { name: string; id: string; score: number }>> {
  const vendorMap = new Map<string, { name: string; id: string; score: number }>();

  // Debug logging for API key
  console.log(`ANTHROPIC_API_KEY present: ${!!ANTHROPIC_API_KEY}, length: ${ANTHROPIC_API_KEY?.length || 0}`);
  console.log(`Procore vendors: ${procoreVendors.length}, QB vendors: ${qbVendors.length}`);

  if (!ANTHROPIC_API_KEY) {
    console.log('AI vendor matching skipped - ANTHROPIC_API_KEY not set in environment');
    return vendorMap;
  }

  if (procoreVendors.length === 0 || qbVendors.length === 0) {
    console.log('AI vendor matching skipped - empty vendor lists');
    return vendorMap;
  }

  // Get unique Procore vendors
  const uniqueProcoreVendors = [...new Set(procoreVendors)].filter(v => v && v !== 'Unknown' && v !== 'Unknown Vendor');

  if (uniqueProcoreVendors.length === 0) {
    return vendorMap;
  }

  // Prepare QB vendor list (just names for the prompt)
  const qbVendorList = qbVendors.map(v => v.DisplayName).slice(0, 200); // Limit to prevent token overflow

  console.log(`AI matching ${uniqueProcoreVendors.length} Procore vendors against ${qbVendorList.length} QB vendors`);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: `You are matching vendor names between two systems (Procore and QuickBooks).
Find the best match for each Procore vendor in the QuickBooks list. Consider:
- Company name variations (Inc, LLC, Corp, etc.)
- Abbreviations and acronyms
- Minor spelling differences
- "DBA" or trade names
- First/last name order for individuals

Procore Vendors:
${uniqueProcoreVendors.map((v, i) => `${i + 1}. ${v}`).join('\n')}

QuickBooks Vendors:
${qbVendorList.map((v, i) => `${i + 1}. ${v}`).join('\n')}

Return ONLY a JSON array of matches. For each Procore vendor, provide the matching QB vendor name or null if no match.
Format: [{"procore": "Procore Vendor Name", "qb": "QuickBooks Vendor Name", "confidence": 85}]
Only include matches with confidence >= 60. Use confidence 100 for exact/near-exact matches, 80-99 for clear matches with minor differences, 60-79 for likely matches.
Return ONLY the JSON array, no other text.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error('AI vendor matching API error:', response.status);
      return vendorMap;
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || '';

    // Parse the JSON response
    try {
      // Extract JSON array from response (handle potential markdown code blocks)
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('No JSON array found in AI response');
        return vendorMap;
      }

      const matches = JSON.parse(jsonMatch[0]);
      console.log(`AI found ${matches.length} vendor matches`);

      for (const match of matches) {
        if (match.procore && match.qb && match.confidence >= 60) {
          // Find the QB vendor ID
          const qbVendor = qbVendors.find(
            v => v.DisplayName.toLowerCase() === match.qb.toLowerCase()
          );
          if (qbVendor) {
            vendorMap.set(match.procore, {
              name: qbVendor.DisplayName,
              id: qbVendor.Id,
              score: match.confidence,
            });
          }
        }
      }

      console.log(`AI vendor map has ${vendorMap.size} entries`);
    } catch (parseError) {
      console.error('Error parsing AI vendor response:', parseError);
    }
  } catch (error) {
    console.error('AI vendor matching error:', error);
  }

  return vendorMap;
}

// Enhanced vendor matching - tries AI first, falls back to fuzzy
function findVendorMatch(
  procoreVendor: string,
  qbVendors: { DisplayName: string; Id: string }[],
  aiVendorMap: Map<string, { name: string; id: string; score: number }>
): { name: string; id: string; score: number } | null {
  // First check AI matches
  const aiMatch = aiVendorMap.get(procoreVendor);
  if (aiMatch) {
    return aiMatch;
  }

  // Fall back to fuzzy matching
  return findBestVendorMatch(procoreVendor, qbVendors);
}

// Match Procore sub invoices to QuickBooks bills
function matchInvoicesToBills(
  procoreInvoices: ProcoreInvoice[],
  qbBills: QBBill[],
  qbVendors: any[],
  aiVendorMap: Map<string, { name: string; id: string; score: number }>
): { results: MatchResult[]; matchedQBBillIds: Set<string> } {
  const results: MatchResult[] = [];
  const matchedQBBillIds = new Set<string>();
  const matchedProcoreIds = new Set<string>();

  for (const pInv of procoreInvoices) {
    const vendorMatch = findVendorMatch(pInv.vendor, qbVendors, aiVendorMap);

    if (!vendorMatch) {
      results.push({
        id: generateId(),
        matchType: 'invoice',
        category: 'accounts_payable',
        description: `Sub Invoice #${pInv.number || pInv.id}`,
        vendor: pInv.vendor,
        customer: null,
        procoreRef: `Invoice ${pInv.number || pInv.id}`,
        qbRef: null,
        procoreValue: pInv.amount,
        qbValue: null,
        variance: pInv.amount,
        variancePct: 100,
        matchConfidence: 0,
        matchMethod: 'no_vendor_match',
        severity: calculateSeverity(pInv.amount, pInv.amount),
        status: 'unmatched_procore',
        notes: `Vendor "${pInv.vendor}" not found in QuickBooks`,
        procoreDate: pInv.billingDate,
        requiresAction: true,
      });
      continue;
    }

    // Find matching bills for this vendor
    const vendorBills = qbBills.filter(
      b => b.vendorId === vendorMatch.id && !matchedQBBillIds.has(b.id)
    );

    // Try to find exact or close match
    let bestBill: QBBill | null = null;
    let bestScore = 0;
    let matchMethod = '';

    for (const bill of vendorBills) {
      let score = 0;

      // Exact amount match
      if (amountMatches(pInv.amount, bill.amount, 0.001)) {
        score += 50;
        matchMethod = 'amount_match';
      } else if (amountMatches(pInv.amount, bill.amount, 0.05)) {
        score += 30;
        matchMethod = 'amount_close';
      }

      // Invoice number match
      if (pInv.number && bill.docNumber) {
        const invNum = normalizeString(pInv.number);
        const billNum = normalizeString(bill.docNumber);
        if (invNum === billNum || invNum.includes(billNum) || billNum.includes(invNum)) {
          score += 40;
          matchMethod = matchMethod ? matchMethod + '+doc_number' : 'doc_number';
        }
      }

      // Date proximity (within 30 days)
      if (pInv.billingDate && bill.date && dateWithinDays(pInv.billingDate, bill.date, 30)) {
        score += 10;
      }

      if (score > bestScore) {
        bestScore = score;
        bestBill = bill;
      }
    }

    if (bestBill && bestScore >= 40) {
      matchedQBBillIds.add(bestBill.id);
      matchedProcoreIds.add(pInv.id);

      const variance = pInv.amount - bestBill.amount;
      results.push({
        id: generateId(),
        matchType: 'invoice',
        category: 'accounts_payable',
        description: `Sub Invoice #${pInv.number || pInv.id}`,
        vendor: pInv.vendor,
        customer: null,
        procoreRef: `Invoice ${pInv.number || pInv.id}`,
        qbRef: `Bill ${bestBill.docNumber || bestBill.id}`,
        procoreValue: pInv.amount,
        qbValue: bestBill.amount,
        variance,
        variancePct: pInv.amount ? (variance / pInv.amount) * 100 : 0,
        matchConfidence: Math.min(bestScore, 100),
        matchMethod,
        severity: calculateSeverity(variance, pInv.amount),
        status: Math.abs(variance) < 1 ? 'matched' : 'partial',
        notes: Math.abs(variance) < 1
          ? `Matched to QB Bill #${bestBill.docNumber}`
          : `Variance of $${Math.abs(variance).toFixed(2)} with QB Bill #${bestBill.docNumber}`,
        procoreDate: pInv.billingDate,
        qbDate: bestBill.date,
        requiresAction: Math.abs(variance) >= 100,
      });
    } else {
      // No good match found - could be timing (not yet entered in QB)
      results.push({
        id: generateId(),
        matchType: 'invoice',
        category: 'accounts_payable',
        description: `Sub Invoice #${pInv.number || pInv.id}`,
        vendor: pInv.vendor,
        customer: null,
        procoreRef: `Invoice ${pInv.number || pInv.id}`,
        qbRef: null,
        procoreValue: pInv.amount,
        qbValue: null,
        variance: pInv.amount,
        variancePct: 100,
        matchConfidence: vendorMatch.score,
        matchMethod: 'vendor_only',
        severity: calculateSeverity(pInv.amount, pInv.amount),
        status: 'timing',
        notes: `No matching bill found in QuickBooks for vendor "${vendorMatch.name}" - may not be entered yet`,
        procoreDate: pInv.billingDate,
        requiresAction: true,
      });
    }
  }

  return { results, matchedQBBillIds };
}

// Match Payment Applications to QB Invoices (AR)
function matchPaymentAppsToInvoices(
  paymentApps: ProcorePaymentApp[],
  qbInvoices: QBInvoice[],
  projectName: string
): MatchResult[] {
  const results: MatchResult[] = [];
  const matchedQBIds = new Set<string>();

  // Try to find the project/owner as a customer in QB
  const projectCustomer = qbInvoices.length > 0
    ? qbInvoices.reduce((best, inv) => {
        const score = fuzzyMatch(projectName, inv.customer);
        if (score > (best?.score || 0)) return { ...inv, score };
        return best;
      }, null as (QBInvoice & { score: number }) | null)
    : null;

  for (const app of paymentApps) {
    // Try to find matching invoice by amount and date
    let bestMatch: QBInvoice | null = null;
    let bestScore = 0;

    for (const inv of qbInvoices) {
      if (matchedQBIds.has(inv.id)) continue;

      let score = 0;

      // Amount match
      if (amountMatches(app.approvedAmount, inv.amount, 0.001)) {
        score += 60;
      } else if (amountMatches(app.approvedAmount, inv.amount, 0.05)) {
        score += 30;
      }

      // Date proximity
      if (app.billingDate && inv.date && dateWithinDays(app.billingDate, inv.date, 45)) {
        score += 20;
      }

      // App number in doc number
      if (app.number && inv.docNumber) {
        const appNum = String(app.number);
        const invNum = String(inv.docNumber);
        if (invNum.includes(appNum) || appNum.includes(invNum)) {
          score += 20;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = inv;
      }
    }

    if (bestMatch && bestScore >= 50) {
      matchedQBIds.add(bestMatch.id);
      const variance = app.approvedAmount - bestMatch.amount;

      results.push({
        id: generateId(),
        matchType: 'payment_app',
        category: 'accounts_receivable',
        description: `Payment Application #${app.number}`,
        vendor: null,
        customer: bestMatch.customer,
        procoreRef: `Pay App #${app.number}`,
        qbRef: `Invoice #${bestMatch.docNumber || bestMatch.id}`,
        procoreValue: app.approvedAmount,
        qbValue: bestMatch.amount,
        variance,
        variancePct: app.approvedAmount ? (variance / app.approvedAmount) * 100 : 0,
        matchConfidence: bestScore,
        matchMethod: 'amount_date',
        severity: calculateSeverity(variance, app.approvedAmount),
        status: Math.abs(variance) < 1 ? 'matched' : 'partial',
        notes: Math.abs(variance) < 1
          ? `Matched to QB Invoice #${bestMatch.docNumber}`
          : `Variance of $${Math.abs(variance).toFixed(2)}`,
        procoreDate: app.billingDate,
        qbDate: bestMatch.date,
        requiresAction: Math.abs(variance) >= 500,
      });
    } else {
      results.push({
        id: generateId(),
        matchType: 'payment_app',
        category: 'accounts_receivable',
        description: `Payment Application #${app.number}`,
        vendor: null,
        customer: null,
        procoreRef: `Pay App #${app.number}`,
        qbRef: null,
        procoreValue: app.approvedAmount,
        qbValue: null,
        variance: app.approvedAmount,
        variancePct: 100,
        matchConfidence: 0,
        matchMethod: 'none',
        severity: calculateSeverity(app.approvedAmount, app.approvedAmount),
        status: 'timing',
        notes: 'No matching customer invoice found in QuickBooks - may not be entered yet',
        procoreDate: app.billingDate,
        requiresAction: true,
      });
    }
  }

  // Find QB invoices not matched to any payment app
  for (const inv of qbInvoices) {
    if (!matchedQBIds.has(inv.id)) {
      results.push({
        id: generateId(),
        matchType: 'payment_app',
        category: 'accounts_receivable',
        description: `QB Invoice #${inv.docNumber || inv.id}`,
        vendor: null,
        customer: inv.customer,
        procoreRef: null,
        qbRef: `Invoice #${inv.docNumber || inv.id}`,
        procoreValue: null,
        qbValue: inv.amount,
        variance: -inv.amount,
        variancePct: -100,
        matchConfidence: 0,
        matchMethod: 'none',
        severity: calculateSeverity(inv.amount, inv.amount),
        status: 'unmatched_qb',
        notes: 'QuickBooks invoice with no matching Procore payment application',
        qbDate: inv.date,
        requiresAction: inv.amount >= 1000,
      });
    }
  }

  return results;
}

// Match Direct Costs to QB Bills
function matchDirectCostsToBills(
  directCosts: ProcoreDirectCost[],
  qbBills: QBBill[],
  matchedBillIds: Set<string>,
  qbVendors: any[],
  aiVendorMap: Map<string, { name: string; id: string; score: number }>
): MatchResult[] {
  const results: MatchResult[] = [];

  for (const dc of directCosts) {
    if (!dc.vendor) {
      results.push({
        id: generateId(),
        matchType: 'direct_cost',
        category: 'direct_cost',
        description: dc.description || `Direct Cost ${dc.id}`,
        vendor: null,
        customer: null,
        procoreRef: dc.invoiceNumber || `DC-${dc.id}`,
        qbRef: null,
        procoreValue: dc.amount,
        qbValue: null,
        variance: dc.amount,
        variancePct: 100,
        matchConfidence: 0,
        matchMethod: 'no_vendor',
        severity: 'warning',
        status: 'unmatched_procore',
        notes: 'Direct cost has no vendor assigned',
        procoreDate: dc.date,
        requiresAction: true,
      });
      continue;
    }

    const vendorMatch = findVendorMatch(dc.vendor, qbVendors, aiVendorMap);

    if (!vendorMatch) {
      results.push({
        id: generateId(),
        matchType: 'direct_cost',
        category: 'direct_cost',
        description: dc.description || `Direct Cost ${dc.id}`,
        vendor: dc.vendor,
        customer: null,
        procoreRef: dc.invoiceNumber || `DC-${dc.id}`,
        qbRef: null,
        procoreValue: dc.amount,
        qbValue: null,
        variance: dc.amount,
        variancePct: 100,
        matchConfidence: 0,
        matchMethod: 'no_vendor_match',
        severity: calculateSeverity(dc.amount, dc.amount),
        status: 'unmatched_procore',
        notes: `Vendor "${dc.vendor}" not found in QuickBooks`,
        procoreDate: dc.date,
        requiresAction: true,
      });
      continue;
    }

    // Find matching bill
    const vendorBills = qbBills.filter(
      b => b.vendorId === vendorMatch.id && !matchedBillIds.has(b.id)
    );

    let bestBill: QBBill | null = null;
    let bestScore = 0;

    for (const bill of vendorBills) {
      let score = 0;

      if (amountMatches(dc.amount, bill.amount, 0.01)) {
        score += 50;
      }

      if (dc.invoiceNumber && bill.docNumber) {
        const dcNum = normalizeString(dc.invoiceNumber);
        const billNum = normalizeString(bill.docNumber);
        if (dcNum === billNum || dcNum.includes(billNum) || billNum.includes(dcNum)) {
          score += 40;
        }
      }

      if (dc.date && bill.date && dateWithinDays(dc.date, bill.date, 30)) {
        score += 10;
      }

      if (score > bestScore) {
        bestScore = score;
        bestBill = bill;
      }
    }

    if (bestBill && bestScore >= 40) {
      matchedBillIds.add(bestBill.id);
      const variance = dc.amount - bestBill.amount;

      results.push({
        id: generateId(),
        matchType: 'direct_cost',
        category: 'direct_cost',
        description: dc.description || `Direct Cost ${dc.id}`,
        vendor: dc.vendor,
        customer: null,
        procoreRef: dc.invoiceNumber || `DC-${dc.id}`,
        qbRef: `Bill ${bestBill.docNumber || bestBill.id}`,
        procoreValue: dc.amount,
        qbValue: bestBill.amount,
        variance,
        variancePct: dc.amount ? (variance / dc.amount) * 100 : 0,
        matchConfidence: bestScore,
        matchMethod: 'amount_doc',
        severity: calculateSeverity(variance, dc.amount),
        status: Math.abs(variance) < 1 ? 'matched' : 'partial',
        notes: Math.abs(variance) < 1
          ? `Matched to QB Bill #${bestBill.docNumber}`
          : `Variance of $${Math.abs(variance).toFixed(2)}`,
        procoreDate: dc.date,
        qbDate: bestBill.date,
        requiresAction: Math.abs(variance) >= 100,
      });
    } else {
      results.push({
        id: generateId(),
        matchType: 'direct_cost',
        category: 'direct_cost',
        description: dc.description || `Direct Cost ${dc.id}`,
        vendor: dc.vendor,
        customer: null,
        procoreRef: dc.invoiceNumber || `DC-${dc.id}`,
        qbRef: null,
        procoreValue: dc.amount,
        qbValue: null,
        variance: dc.amount,
        variancePct: 100,
        matchConfidence: vendorMatch.score,
        matchMethod: 'vendor_only',
        severity: calculateSeverity(dc.amount, dc.amount),
        status: 'timing',
        notes: `No matching bill found for vendor "${vendorMatch.name}"`,
        procoreDate: dc.date,
        requiresAction: true,
      });
    }
  }

  return results;
}

// Find unmatched QB bills - only include bills that could plausibly match a Procore invoice
// (same vendor, similar amount range)
function findUnmatchedQBBills(
  qbBills: QBBill[],
  matchedIds: Set<string>,
  projectVendorIds: Set<string>,
  qbVendors: any[],
  procoreInvoices: ProcoreInvoice[],
  directCosts: ProcoreDirectCost[]
): MatchResult[] {
  const results: MatchResult[] = [];

  // Build a map of Procore amounts by vendor (lowercase)
  const procoreAmountsByVendor = new Map<string, number[]>();
  for (const inv of procoreInvoices) {
    const vendorKey = inv.vendor.toLowerCase();
    if (!procoreAmountsByVendor.has(vendorKey)) {
      procoreAmountsByVendor.set(vendorKey, []);
    }
    procoreAmountsByVendor.get(vendorKey)!.push(inv.amount);
  }
  for (const dc of directCosts) {
    if (dc.vendor) {
      const vendorKey = dc.vendor.toLowerCase();
      if (!procoreAmountsByVendor.has(vendorKey)) {
        procoreAmountsByVendor.set(vendorKey, []);
      }
      procoreAmountsByVendor.get(vendorKey)!.push(dc.amount);
    }
  }

  // Only look at bills from vendors in the project (not all QB bills)
  for (const bill of qbBills) {
    if (matchedIds.has(bill.id)) continue;

    // Check if this bill's vendor is in the project
    if (!projectVendorIds.has(bill.vendorId)) continue;

    // Check if bill amount is in the range of any Procore invoice from this vendor
    // Allow 25% tolerance or $500, whichever is greater
    const vendorKey = bill.vendor.toLowerCase();
    const procoreAmounts = procoreAmountsByVendor.get(vendorKey) || [];

    let couldMatch = false;
    for (const procoreAmt of procoreAmounts) {
      const tolerance = Math.max(procoreAmt * 0.25, 500);
      if (Math.abs(bill.amount - procoreAmt) <= tolerance) {
        couldMatch = true;
        break;
      }
    }

    // Skip bills that don't have any similar Procore amounts (likely from other projects)
    if (!couldMatch && procoreAmounts.length > 0) {
      continue;
    }

    // If vendor has no Procore invoices at all, skip entirely (they're just in commitments)
    if (procoreAmounts.length === 0) {
      continue;
    }

    results.push({
      id: generateId(),
      matchType: 'invoice',
      category: 'accounts_payable',
      description: `QB Bill #${bill.docNumber || bill.id}`,
      vendor: bill.vendor,
      customer: null,
      procoreRef: null,
      qbRef: `Bill #${bill.docNumber || bill.id}`,
      procoreValue: null,
      qbValue: bill.amount,
      variance: -bill.amount,
      variancePct: -100,
      matchConfidence: 0,
      matchMethod: 'none',
      severity: calculateSeverity(bill.amount, bill.amount),
      status: 'unmatched_qb',
      notes: 'QuickBooks bill with similar amount to a Procore invoice - needs manual review',
      qbDate: bill.date,
      requiresAction: bill.amount >= 500,
    });
  }

  console.log(`Found ${results.length} unmatched QB bills that could match Procore invoices`);
  return results;
}

// Vendor-level totals reconciliation
function reconcileVendorTotals(
  commitments: ProcoreCommitment[],
  qbBills: QBBill[],
  qbVendors: any[],
  aiVendorMap: Map<string, { name: string; id: string; score: number }>
): MatchResult[] {
  const results: MatchResult[] = [];

  // Group by vendor
  const commitmentsByVendor = new Map<string, ProcoreCommitment[]>();
  for (const c of commitments) {
    const key = c.vendor.toLowerCase();
    if (!commitmentsByVendor.has(key)) commitmentsByVendor.set(key, []);
    commitmentsByVendor.get(key)!.push(c);
  }

  const billsByVendor = new Map<string, QBBill[]>();
  for (const b of qbBills) {
    const key = b.vendor.toLowerCase();
    if (!billsByVendor.has(key)) billsByVendor.set(key, []);
    billsByVendor.get(key)!.push(b);
  }

  for (const [vendorKey, comms] of commitmentsByVendor) {
    const procoreTotal = comms.reduce((sum, c) => sum + c.currentValue, 0);
    const procoreBilled = comms.reduce((sum, c) => sum + c.billedToDate, 0);
    const vendorName = comms[0].vendor;

    const vendorMatch = findVendorMatch(vendorName, qbVendors, aiVendorMap);

    if (!vendorMatch) {
      results.push({
        id: generateId(),
        matchType: 'vendor_total',
        category: 'accounts_payable',
        description: `Vendor Total: ${vendorName}`,
        vendor: vendorName,
        customer: null,
        procoreRef: `${comms.length} commitment(s)`,
        qbRef: null,
        procoreValue: procoreTotal,
        qbValue: null,
        variance: procoreTotal,
        variancePct: 100,
        matchConfidence: 0,
        matchMethod: 'no_vendor_match',
        severity: calculateSeverity(procoreTotal, procoreTotal),
        status: 'unmatched_procore',
        notes: `Vendor not found in QuickBooks. Procore shows $${procoreTotal.toFixed(2)} committed.`,
        requiresAction: true,
      });
      continue;
    }

    const vendorBills = billsByVendor.get(vendorMatch.name.toLowerCase()) || [];
    const qbTotal = vendorBills.reduce((sum, b) => sum + b.amount, 0);

    const variance = procoreBilled - qbTotal;

    results.push({
      id: generateId(),
      matchType: 'vendor_total',
      category: 'accounts_payable',
      description: `Vendor Total: ${vendorName}`,
      vendor: vendorName,
      customer: null,
      procoreRef: `${comms.length} commitment(s), $${procoreBilled.toFixed(2)} billed`,
      qbRef: `${vendorBills.length} bill(s), $${qbTotal.toFixed(2)} total`,
      procoreValue: procoreBilled,
      qbValue: qbTotal,
      variance,
      variancePct: procoreBilled ? (variance / procoreBilled) * 100 : 0,
      matchConfidence: vendorMatch.score,
      matchMethod: 'vendor_aggregate',
      severity: calculateSeverity(variance, procoreBilled),
      status: Math.abs(variance) < 100 ? 'matched' : 'partial',
      notes: Math.abs(variance) < 100
        ? `Vendor totals reconcile within $100`
        : `Variance of $${Math.abs(variance).toFixed(2)} between billed in Procore and QB bills`,
      requiresAction: Math.abs(variance) >= 1000,
    });
  }

  return results;
}

// Generate closeout items
function generateCloseoutItems(
  commitments: ProcoreCommitment[],
  matchResults: MatchResult[]
): CloseoutItem[] {
  const items: CloseoutItem[] = [];
  let itemNum = 1;

  // Outstanding retention
  for (const c of commitments) {
    if (c.retentionHeld > 100) {
      items.push({
        itemId: `CI-${String(itemNum++).padStart(4, '0')}`,
        category: 'retention',
        description: `Release retention for ${c.vendor} - ${c.title || c.type}`,
        vendor: c.vendor,
        amountAtRisk: c.retentionHeld,
        actionRequired: `Verify work completion and process $${c.retentionHeld.toFixed(2)} retention release`,
        priority: 3,
      });
    }
  }

  // Critical variances
  for (const r of matchResults) {
    if (r.severity === 'critical' && r.status !== 'matched') {
      items.push({
        itemId: `CI-${String(itemNum++).padStart(4, '0')}`,
        category: 'variance',
        description: `Critical: ${r.description}`,
        vendor: r.vendor,
        amountAtRisk: Math.abs(r.variance),
        actionRequired: r.notes || 'Investigate and resolve variance',
        priority: 1,
      });
    }
  }

  // Unmatched items needing action
  for (const r of matchResults) {
    if (r.status === 'unmatched_procore' && r.procoreValue && r.procoreValue >= 1000) {
      items.push({
        itemId: `CI-${String(itemNum++).padStart(4, '0')}`,
        category: 'missing_entry',
        description: `Enter in QuickBooks: ${r.description}`,
        vendor: r.vendor,
        amountAtRisk: r.procoreValue,
        actionRequired: `Create bill/entry in QuickBooks for $${r.procoreValue.toFixed(2)}`,
        priority: 2,
      });
    }
    if (r.status === 'unmatched_qb' && r.qbValue && r.qbValue >= 1000) {
      items.push({
        itemId: `CI-${String(itemNum++).padStart(4, '0')}`,
        category: 'missing_entry',
        description: `Verify in Procore: ${r.description}`,
        vendor: r.vendor,
        amountAtRisk: Math.abs(r.qbValue),
        actionRequired: `Verify this QuickBooks entry ($${Math.abs(r.qbValue).toFixed(2)}) is recorded in Procore`,
        priority: 2,
      });
    }
  }

  return items;
}

// AI analysis
async function getAIAnalysis(results: MatchResult[], summary: any): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;

  const criticalItems = results.filter(r => r.severity === 'critical');
  const unmatchedProcore = results.filter(r => r.status === 'unmatched_procore');
  const unmatchedQB = results.filter(r => r.status === 'unmatched_qb');

  if (criticalItems.length === 0 && unmatchedProcore.length === 0 && unmatchedQB.length === 0) {
    return 'All items reconciled successfully. No significant discrepancies found between Procore and QuickBooks.';
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `You are a construction financial analyst reviewing a project closeout reconciliation between Procore (project management) and QuickBooks (accounting).

Summary:
- Total Committed in Procore: $${summary.totalCommitted.toFixed(2)}
- Total Billed by Subs: $${summary.totalBilled.toFixed(2)}
- Total Paid to Subs: $${summary.totalPaid.toFixed(2)}
- Retention Held: $${summary.totalRetention.toFixed(2)}
- Items with Critical Variances: ${criticalItems.length}
- Procore items not in QuickBooks: ${unmatchedProcore.length}
- QuickBooks items not in Procore: ${unmatchedQB.length}

Critical Discrepancies:
${JSON.stringify(criticalItems.slice(0, 5), null, 2)}

Provide a 2-3 sentence executive summary focusing on:
1. The most significant financial risk
2. Recommended priority action`,
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.content?.[0]?.text || null;
  } catch (error) {
    console.error('AI analysis error:', error);
    return null;
  }
}

// ============== Main Handler ==============

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
    const { procoreData, projectId, userId } = JSON.parse(event.body || '{}');

    if (!procoreData || !userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Procore data and userId required' }),
      };
    }

    const projectName = procoreData.project?.name || 'Unknown Project';

    // STEP 1: Normalize Procore data first (before fetching QB data)
    const commitments = normalizeCommitments(procoreData);
    const procoreInvoices = normalizeProcoreInvoices(procoreData);
    const paymentApps = normalizePaymentApps(procoreData);
    const directCosts = normalizeDirectCosts(procoreData);

    console.log(`Procore data: ${commitments.length} commitments, ${procoreInvoices.length} invoices, ${paymentApps.length} pay apps, ${directCosts.length} direct costs`);

    // STEP 2: Collect all unique Procore vendor names
    const allProcoreVendors: string[] = [
      ...commitments.map(c => c.vendor),
      ...procoreInvoices.map(inv => inv.vendor),
      ...directCosts.map(dc => dc.vendor).filter(Boolean) as string[],
    ];
    const uniqueProcoreVendors = [...new Set(allProcoreVendors)].filter(v => v && v !== 'Unknown' && v !== 'Unknown Vendor');
    console.log(`Found ${uniqueProcoreVendors.length} unique Procore vendors`);

    // STEP 3: Fetch only QB vendors (lightweight query)
    console.log('Fetching QuickBooks vendors...');
    const { vendors: qbVendors, tokens: qbTokens } = await fetchQBVendors(userId);

    // STEP 4: Use AI to match vendors
    console.log('Starting AI vendor matching...');
    const aiVendorMap = await matchVendorsWithAI(uniqueProcoreVendors, qbVendors);
    console.log(`AI vendor matching complete: ${aiVendorMap.size} matches found`);

    // STEP 5: Build set of QB vendor IDs that are relevant to this project
    const projectVendorIds = new Set<string>();

    // Add vendors from commitments (using AI-enhanced matching)
    for (const c of commitments) {
      const match = findVendorMatch(c.vendor, qbVendors, aiVendorMap);
      if (match) projectVendorIds.add(match.id);
    }

    // Add vendors from invoices
    for (const inv of procoreInvoices) {
      const match = findVendorMatch(inv.vendor, qbVendors, aiVendorMap);
      if (match) projectVendorIds.add(match.id);
    }

    // Add vendors from direct costs
    for (const dc of directCosts) {
      if (dc.vendor) {
        const match = findVendorMatch(dc.vendor, qbVendors, aiVendorMap);
        if (match) projectVendorIds.add(match.id);
      }
    }

    console.log(`Found ${projectVendorIds.size} QB vendors relevant to this project`);

    // STEP 6: Fetch all QB bills for project vendors (for manual matching)
    const projectVendorIdArray = Array.from(projectVendorIds);
    const qbBillsRaw = await fetchQBBillsForVendors(projectVendorIdArray, qbTokens, userId);

    // STEP 8: Fetch AR data (invoices and payments) - only if we have payment apps
    // Filter by customer matching the project name (get all invoices to catch discrepancies)
    let qbInvoicesRaw: any[] = [];
    let qbPaymentsRaw: any[] = [];
    let matchedQBCustomer: string | null = null;
    if (paymentApps.length > 0) {
      const arData = await fetchQBInvoicesAndPayments(qbTokens, userId, projectName);
      qbInvoicesRaw = arData.invoices;
      qbPaymentsRaw = arData.paymentsReceived;
      matchedQBCustomer = arData.matchedCustomer;
    }

    // Normalize QB data
    const qbBills = normalizeQBBills({ bills: qbBillsRaw });
    const qbBillPayments: QBBillPayment[] = []; // Not needed for targeted matching
    const qbInvoices = normalizeQBInvoices({ invoices: qbInvoicesRaw });
    const qbPayments = normalizeQBPayments({ paymentsReceived: qbPaymentsRaw });

    console.log(`QB data for project: ${qbBills.length} bills, ${qbInvoices.length} invoices`);

    // Run all matching
    const allResults: MatchResult[] = [];

    // 1. Match sub invoices to QB bills
    const { results: invoiceResults, matchedQBBillIds } = matchInvoicesToBills(
      procoreInvoices,
      qbBills,
      qbVendors,
      aiVendorMap
    );
    allResults.push(...invoiceResults);

    // 2. Match direct costs to remaining QB bills
    const directCostResults = matchDirectCostsToBills(
      directCosts,
      qbBills,
      matchedQBBillIds,
      qbVendors,
      aiVendorMap
    );
    allResults.push(...directCostResults);

    // 3. Find unmatched QB bills (only for project vendors, not all QB bills)
    const unmatchedBillResults = findUnmatchedQBBills(qbBills, matchedQBBillIds, projectVendorIds, qbVendors, procoreInvoices, directCosts);
    allResults.push(...unmatchedBillResults);

    // 4. Match payment applications to QB invoices (AR)
    const paymentAppResults = matchPaymentAppsToInvoices(paymentApps, qbInvoices, projectName);
    allResults.push(...paymentAppResults);

    // 5. Vendor-level totals
    const vendorTotalResults = reconcileVendorTotals(commitments, qbBills, qbVendors, aiVendorMap);
    allResults.push(...vendorTotalResults);

    // Log results breakdown by type
    const invoiceCount = allResults.filter(r => r.matchType === 'invoice').length;
    const paymentAppCount = allResults.filter(r => r.matchType === 'payment_app').length;
    const directCostCount = allResults.filter(r => r.matchType === 'direct_cost').length;
    const vendorTotalCount = allResults.filter(r => r.matchType === 'vendor_total').length;
    console.log(`Results breakdown: ${invoiceCount} invoices, ${paymentAppCount} payment apps, ${directCostCount} direct costs, ${vendorTotalCount} vendor totals`);
    console.log(`Total results: ${allResults.length}`);

    // Generate closeout items
    const closeoutItems = generateCloseoutItems(commitments, allResults);
    console.log(`Generated ${closeoutItems.length} closeout items`);

    // Calculate summary stats
    const totalCommitted = commitments.reduce((sum, c) => sum + c.currentValue, 0);
    const totalBilled = commitments.reduce((sum, c) => sum + c.billedToDate, 0);
    const totalPaid = commitments.reduce((sum, c) => sum + c.paidToDate, 0);
    const totalRetention = commitments.reduce((sum, c) => sum + c.retentionHeld, 0);

    const matchedCount = allResults.filter(r => r.status === 'matched').length;
    const partialCount = allResults.filter(r => r.status === 'partial').length;
    const warningCount = allResults.filter(r => r.severity === 'warning').length;
    const criticalCount = allResults.filter(r => r.severity === 'critical').length;
    const totalExposure = closeoutItems.reduce((sum, i) => sum + i.amountAtRisk, 0);

    const summaryData = { totalCommitted, totalBilled, totalPaid, totalRetention };

    // Get AI summary
    const aiSummary = await getAIAnalysis(allResults, summaryData);

    // Build report
    const report = {
      id: null as string | null,
      project_id: projectId,
      project_name: projectName,
      generated_at: new Date().toISOString(),
      total_committed: totalCommitted,
      total_billed_by_subs: totalBilled,
      total_paid_to_subs: totalPaid,
      sub_retention_held: totalRetention,
      total_items: allResults.length,
      matched_items: matchedCount,
      partial_matches: partialCount,
      reconciled_items: matchedCount + partialCount,
      warning_items: warningCount,
      critical_items: criticalCount,
      open_closeout_items: closeoutItems.length,
      estimated_exposure: totalExposure,
      executive_summary: aiSummary,
      results: allResults,
      closeout_items: closeoutItems,
      commitments: commitments.map(c => ({
        vendor: c.vendor,
        procore_id: c.id,
        commitment_type: c.type,
        number: c.number,
        title: c.title,
        status: c.status,
        original_amount: c.originalAmount,
        approved_changes: c.approvedChanges,
        pending_changes: c.pendingChanges,
        current_value: c.currentValue,
        billed_to_date: c.billedToDate,
        paid_to_date: c.paidToDate,
        retention_held: c.retentionHeld,
        balance_remaining: c.currentValue - c.billedToDate,
      })),
      // Summary by category
      summary_by_category: {
        accounts_payable: {
          total_items: allResults.filter(r => r.category === 'accounts_payable').length,
          matched: allResults.filter(r => r.category === 'accounts_payable' && r.status === 'matched').length,
          total_variance: allResults
            .filter(r => r.category === 'accounts_payable')
            .reduce((sum, r) => sum + Math.abs(r.variance), 0),
        },
        accounts_receivable: {
          total_items: allResults.filter(r => r.category === 'accounts_receivable').length,
          matched: allResults.filter(r => r.category === 'accounts_receivable' && r.status === 'matched').length,
          total_variance: allResults
            .filter(r => r.category === 'accounts_receivable')
            .reduce((sum, r) => sum + Math.abs(r.variance), 0),
        },
        direct_costs: {
          total_items: allResults.filter(r => r.category === 'direct_cost').length,
          matched: allResults.filter(r => r.category === 'direct_cost' && r.status === 'matched').length,
          total_variance: allResults
            .filter(r => r.category === 'direct_cost')
            .reduce((sum, r) => sum + Math.abs(r.variance), 0),
        },
      },
    };

    // Save to Supabase if we have a project ID
    if (projectId && userId) {
      try {
        // First ensure project exists
        console.log('Upserting project:', projectId);

        // Procore IDs can be very large - check if it fits in PostgreSQL INTEGER range
        const procoreId = procoreData.project?.id;
        const safeProoreId = (procoreId && procoreId <= 2147483647) ? procoreId : null;

        const { error: projectError } = await supabase.from('projects').upsert(
          {
            id: projectId,
            procore_id: safeProoreId,
            name: projectName,
            project_number: procoreData.project?.project_number || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        );

        if (projectError) {
          console.error('Error upserting project:', projectError);
          // Don't fail the whole request, but report ID won't be saved
        } else {
          console.log('Project upserted successfully');
        }

        // Insert report
        console.log('Saving report to Supabase, projectId:', projectId);
        const { data: reportData, error: reportError } = await supabase
          .from('reconciliation_reports')
          .insert({
            project_id: projectId,
            generated_at: report.generated_at,
            total_committed: report.total_committed,
            total_billed_by_subs: report.total_billed_by_subs,
            total_paid_to_subs: report.total_paid_to_subs,
            sub_retention_held: report.sub_retention_held,
            reconciled_items: report.reconciled_items,
            warning_items: report.warning_items,
            critical_items: report.critical_items,
            open_closeout_items: report.open_closeout_items,
            estimated_exposure: report.estimated_exposure,
            executive_summary: report.executive_summary,
          })
          .select()
          .single();

        if (reportError) {
          console.error('Error saving report:', reportError);
        }

        if (reportData) {
          console.log('Report saved with ID:', reportData.id);
          report.id = reportData.id;

          // Insert results
          if (allResults.length > 0) {
            console.log(`Inserting ${allResults.length} reconciliation results...`);
            const { error: resultsError } = await supabase.from('reconciliation_results').insert(
              allResults.map(r => ({
                report_id: reportData.id,
                result_id: r.id,
                item_type: r.matchType,
                item_description: r.description,
                vendor: r.vendor,
                procore_value: r.procoreValue,
                qb_value: r.qbValue,
                variance: r.variance,
                variance_pct: r.variancePct,
                severity: r.severity,
                notes: r.notes,
                procore_ref: r.procoreRef,
                qb_ref: r.qbRef,
                requires_action: r.requiresAction,
              }))
            );
            if (resultsError) {
              console.error('Error inserting results:', resultsError);
            } else {
              console.log('Results inserted successfully');
            }
          }

          // Insert closeout items
          if (closeoutItems.length > 0) {
            await supabase.from('closeout_items').insert(
              closeoutItems.map(i => ({
                report_id: reportData.id,
                item_id: i.itemId,
                category: i.category,
                description: i.description,
                vendor: i.vendor,
                amount_at_risk: i.amountAtRisk,
                action_required: i.actionRequired,
                priority: i.priority,
                status: 'open',
              }))
            );
          }

          // Insert commitments
          if (report.commitments.length > 0) {
            await supabase.from('commitments').insert(
              report.commitments.map(c => ({
                report_id: reportData.id,
                vendor: c.vendor,
                procore_id: c.procore_id,
                commitment_type: c.commitment_type,
                title: c.title,
                original_amount: c.original_amount,
                approved_changes: c.approved_changes,
                current_value: c.current_value,
                billed_to_date: c.billed_to_date,
                paid_to_date: c.paid_to_date,
                retention_held: c.retention_held,
                balance_remaining: c.balance_remaining,
              }))
            );
          }
        }
      } catch (dbError) {
        console.error('Database save error:', dbError);
        // Continue even if save fails - return the report
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(report),
    };
  } catch (error: any) {
    console.error('Reconciliation error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};
