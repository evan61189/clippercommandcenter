import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// Use env vars with hardcoded fallback for Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://mctfnfczyznsecinspvi.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jdGZuZmN6eXpuc2VjaW5zcHZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTM2MjksImV4cCI6MjA5MTgyOTYyOX0.0uF7wtkT_4qUvLbXnacUijFVjXjEKhL3XComyQUPwXY';
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
  const clientId = process.env.QBO_CLIENT_ID || '';
  const clientSecret = process.env.QBO_CLIENT_SECRET || '';

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

  if (!response.ok) {
    console.error(`QB token refresh failed: ${response.status}`);
    return null;
  }

  // Guard against HTML responses (e.g. proxy/gateway errors)
  const responseText = await response.text();
  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch {
    console.error(`QB token refresh returned non-JSON: ${responseText.slice(0, 200)}`);
    return null;
  }
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
    const errorBody = await response.text().catch(() => '');
    throw new Error(`QuickBooks API error: ${response.status} - ${errorBody.slice(0, 200)}`);
  }

  // Guard against HTML responses (e.g. proxy/gateway errors returning 200 with HTML)
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`QuickBooks returned non-JSON response (status ${response.status}): ${text.slice(0, 200)}`);
  }
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

  // ========== DEBUG: Log raw QB bill structure ==========
  if (vendorBills.length > 0) {
    const bill1 = vendorBills[0];
    console.log('========== RAW QB BILL DEBUG ==========');
    console.log('QB BILL #1 - ALL KEYS:', Object.keys(bill1).join(', '));
    console.log('QB BILL #1 - FULL STRUCTURE:', JSON.stringify(bill1, null, 2));

    // Log a second bill for comparison
    if (vendorBills.length > 1) {
      const bill2 = vendorBills[1];
      console.log('QB BILL #2 - COMPARISON:', JSON.stringify({
        Id: bill2.Id,
        DocNumber: bill2.DocNumber,
        VendorRef: bill2.VendorRef,
        TotalAmt: bill2.TotalAmt,
        Balance: bill2.Balance,
        TxnDate: bill2.TxnDate,
        // Customer/Project related fields
        CustomerRef: bill2.CustomerRef,
        CustomerMemo: bill2.CustomerMemo,
        ClassRef: bill2.ClassRef,
        DepartmentRef: bill2.DepartmentRef,
        ProjectRef: bill2.ProjectRef,
        PrivateNote: bill2.PrivateNote,
        Memo: bill2.Memo,
      }, null, 2));
    }
    console.log('========== END QB BILL DEBUG ==========');
  }

  return vendorBills;
}

// Find the QB customer that matches the project name
// Checks both DisplayName and FullyQualifiedName (with ":" -> " ") for sub-customer matching
// Returns the matched customer ID, name, and ancestor customer IDs (parent chain)
async function findProjectCustomer(
  tokens: QBTokenData,
  userId: string,
  projectName: string
): Promise<{ customerId: string; customerName: string; ancestorCustomerIds: string[] } | null> {
  console.log('Finding QB customer for project...');

  const customers = await paginatedQBQuery('SELECT * FROM Customer WHERE Active = true', 'Customer', tokens, userId);
  console.log(`Found ${customers.length} QB customers`);

  // Build a map for quick lookup by ID (needed for parent chain traversal)
  const customerById = new Map<string, any>();
  for (const c of customers) {
    customerById.set(c.Id, c);
  }

  let bestCustomer: { Id: string; DisplayName: string; FullyQualifiedName: string; score: number } | null = null;
  for (const customer of customers) {
    const displayName = customer.DisplayName || '';
    const fqn = customer.FullyQualifiedName || '';
    // Normalize FQN: replace ":" separator with space so "Domino Sugar:Restrooms Phase 1B" -> "Domino Sugar Restrooms Phase 1B"
    const fqnNormalized = fqn.replace(/:/g, ' ');

    // Score against both DisplayName and FQN, take the higher score
    const displayScore = displayName ? fuzzyMatch(projectName, displayName) : 0;
    const fqnScore = fqnNormalized ? fuzzyMatch(projectName, fqnNormalized) : 0;
    const score = Math.max(displayScore, fqnScore);

    if (score >= 70 && (!bestCustomer || score > bestCustomer.score)) {
      bestCustomer = { Id: customer.Id, DisplayName: displayName || fqn, FullyQualifiedName: fqn, score };
    }
  }

  if (bestCustomer) {
    // Walk up the ParentRef chain to collect ancestor customer IDs
    const ancestorCustomerIds: string[] = [];
    let currentCustomer = customerById.get(bestCustomer.Id);
    while (currentCustomer?.ParentRef?.value) {
      const parentId = currentCustomer.ParentRef.value;
      ancestorCustomerIds.push(parentId);
      currentCustomer = customerById.get(parentId);
    }

    console.log(`Matched project "${projectName}" to QB customer "${bestCustomer.DisplayName}" (FQN: "${bestCustomer.FullyQualifiedName}", ID: ${bestCustomer.Id}, score: ${bestCustomer.score})`);
    if (ancestorCustomerIds.length > 0) {
      console.log(`  Ancestor customer IDs (parent chain): [${ancestorCustomerIds.join(', ')}]`);
    }
    return { customerId: bestCustomer.Id, customerName: bestCustomer.DisplayName, ancestorCustomerIds };
  }

  console.log(`No matching QB customer found for project "${projectName}"`);
  return null;
}

// Filter QB bills to only include those with CustomerRef matching the project
// Bills with NO CustomerRef are only included if they have BOTH:
// 1. Exact dollar amount match to a Procore invoice
// 2. Vendor match to the same Procore invoice
interface ProcoreInvoiceRef {
  amount: number;
  vendor: string;
  qbVendorId: string | null; // Pre-matched QB vendor ID
}

function filterBillsByProjectCustomer(
  bills: any[],
  projectCustomerId: string,
  procoreInvoiceRefs: ProcoreInvoiceRef[] = [],
  projectVendorIds: Set<string> = new Set(),
  ancestorCustomerIds: string[] = []
): any[] {
  if (!projectCustomerId) {
    // Without a project customer, only include bills from known project vendors
    // This prevents bills for other jobs from leaking into results
    if (projectVendorIds.size === 0 && procoreInvoiceRefs.length === 0) return [];
    const knownVendorIds = new Set(projectVendorIds);
    for (const ref of procoreInvoiceRefs) {
      if (ref.qbVendorId) knownVendorIds.add(ref.qbVendorId);
    }
    const filtered = bills.filter(bill => {
      const billVendorId = bill.VendorRef?.value;
      return billVendorId && knownVendorIds.has(String(billVendorId));
    });
    console.log(`No project customer ID - filtered ${bills.length} bills to ${filtered.length} by project vendor IDs (${knownVendorIds.size} vendors)`);
    return filtered;
  }

  // Build a map of amount -> list of QB vendor IDs that have invoices at that amount
  const amountToVendorIds = new Map<number, Set<string>>();
  for (const ref of procoreInvoiceRefs) {
    if (ref.qbVendorId) {
      const roundedAmount = Math.round(ref.amount * 100) / 100;
      if (!amountToVendorIds.has(roundedAmount)) {
        amountToVendorIds.set(roundedAmount, new Set());
      }
      amountToVendorIds.get(roundedAmount)!.add(ref.qbVendorId);
    }
  }

  // Build a set of ancestor customer IDs for quick lookup
  const ancestorIdSet = new Set(ancestorCustomerIds);

  const included: any[] = [];
  const ancestorMatched: any[] = [];
  const noCustomerRefMatched: any[] = [];
  const noCustomerRefExcluded: any[] = [];
  const excluded: any[] = [];

  for (const bill of bills) {
    // Check if any line item has a CustomerRef matching the project or an ancestor
    const lines = bill.Line || [];
    let matchFound = false;
    let ancestorMatchFound = false;
    let hasAnyCustomerRef = false;
    const lineCustomerRefs: string[] = [];

    for (const line of lines) {
      const customerRef =
        line.AccountBasedExpenseLineDetail?.CustomerRef?.value ||
        line.ItemBasedExpenseLineDetail?.CustomerRef?.value;
      const customerName =
        line.AccountBasedExpenseLineDetail?.CustomerRef?.name ||
        line.ItemBasedExpenseLineDetail?.CustomerRef?.name;

      if (customerRef) {
        hasAnyCustomerRef = true;
        lineCustomerRefs.push(`${customerRef}:${customerName || 'unknown'}`);
      }

      if (customerRef === projectCustomerId) {
        matchFound = true;
      } else if (customerRef && ancestorIdSet.has(customerRef)) {
        ancestorMatchFound = true;
      }
    }

    if (matchFound) {
      // Bill has CustomerRef matching project - include it
      included.push(bill);
    } else if (ancestorMatchFound) {
      // Bill is tagged to a parent/ancestor customer - include only if vendor is a known project vendor
      // This handles cases where bills are tagged to the parent job (e.g. "Domino Sugar") rather than sub-job
      const billVendorId = bill.VendorRef?.value;
      if (billVendorId && projectVendorIds.has(String(billVendorId))) {
        ancestorMatched.push(bill);
        included.push(bill);
      } else {
        excluded.push({
          Id: bill.Id,
          DocNumber: bill.DocNumber,
          VendorRef: bill.VendorRef,
          TotalAmt: bill.TotalAmt,
          TxnDate: bill.TxnDate,
          lineCustomerRefs,
          reason: 'ancestor-customer-non-project-vendor',
        });
      }
    } else if (!hasAnyCustomerRef) {
      // Bill has NO CustomerRef - only include if exact amount AND vendor match
      const billAmount = Math.round(parseFloat(bill.TotalAmt || 0) * 100) / 100;
      const billVendorId = bill.VendorRef?.value;
      const billVendorName = bill.VendorRef?.name;

      // Check if there's a Procore invoice with this exact amount from this vendor,
      // OR if this vendor is a known project vendor (has a commitment/invoice on the project)
      const vendorIdsAtAmount = amountToVendorIds.get(billAmount);
      const isKnownProjectVendor = billVendorId && projectVendorIds.has(String(billVendorId));
      if ((vendorIdsAtAmount && billVendorId && vendorIdsAtAmount.has(String(billVendorId))) || isKnownProjectVendor) {
        noCustomerRefMatched.push(bill);
        included.push(bill);
      } else {
        // Debug: log why this bill didn't match
        const hasAmountMatch = amountToVendorIds.has(billAmount);
        const vendorIdStr = String(billVendorId);
        console.log(`NO-CUSTOMERREF BILL EXCLUDED: Bill #${bill.DocNumber || bill.Id} | $${billAmount} | Vendor: "${billVendorName}" (ID: ${billVendorId})`);
        console.log(`  - Amount ${billAmount} in Procore: ${hasAmountMatch}`);
        if (hasAmountMatch) {
          const expectedVendorIds = [...(vendorIdsAtAmount || [])];
          console.log(`  - Expected vendor IDs for this amount: [${expectedVendorIds.join(', ')}]`);
          console.log(`  - Bill vendor ID "${vendorIdStr}" matches: ${vendorIdsAtAmount?.has(vendorIdStr)}`);
        }
        noCustomerRefExcluded.push({
          Id: bill.Id,
          DocNumber: bill.DocNumber,
          VendorRef: bill.VendorRef,
          TotalAmt: bill.TotalAmt,
        });
      }
    } else {
      // Bill has CustomerRef but for a different project
      excluded.push({
        Id: bill.Id,
        DocNumber: bill.DocNumber,
        VendorRef: bill.VendorRef,
        TotalAmt: bill.TotalAmt,
        TxnDate: bill.TxnDate,
        lineCustomerRefs,
      });
    }
  }

  // Log filtering results
  console.log(`========== BILL FILTER DEBUG ==========`);
  console.log(`Project CustomerRef ID: ${projectCustomerId}`);
  console.log(`Ancestor CustomerRef IDs: [${ancestorCustomerIds.join(', ')}]`);
  console.log(`Procore invoices for matching: ${procoreInvoiceRefs.length}`);
  console.log(`Bills with matching CustomerRef: ${included.length - noCustomerRefMatched.length - ancestorMatched.length}`);
  console.log(`Bills with ancestor CustomerRef + project vendor: ${ancestorMatched.length}`);
  console.log(`Bills with NO CustomerRef + exact amount+vendor match: ${noCustomerRefMatched.length}`);
  console.log(`Bills with NO CustomerRef excluded (no match): ${noCustomerRefExcluded.length}`);
  console.log(`Bills excluded (different CustomerRef): ${excluded.length}`);
  if (noCustomerRefMatched.length > 0) {
    console.log(`Bills with NO CustomerRef that matched (first 5):`);
    for (const bill of noCustomerRefMatched.slice(0, 5)) {
      console.log(`  - Bill #${bill.DocNumber || bill.Id} | Vendor: ${bill.VendorRef?.name} | $${bill.TotalAmt}`);
    }
  }
  if (excluded.length > 0) {
    console.log(`Sample excluded bills (first 5):`);
    for (const bill of excluded.slice(0, 5)) {
      console.log(`  - Bill #${bill.DocNumber || bill.Id} | Vendor: ${bill.VendorRef?.name} | $${bill.TotalAmt} | CustomerRefs: [${bill.lineCustomerRefs.join(', ') || 'NONE'}]`);
    }
  }
  console.log(`========== END BILL FILTER DEBUG ==========`);

  return included;
}

// Fetch ALL QB bills and filter by project CustomerRef
// Bills with no CustomerRef are only included if they match a Procore invoice (amount + vendor)
async function fetchAllBillsForProject(
  tokens: QBTokenData,
  userId: string,
  projectCustomerId: string | null,
  procoreInvoiceRefs: ProcoreInvoiceRef[] = [],
  projectVendorIds: Set<string> = new Set(),
  ancestorCustomerIds: string[] = []
): Promise<any[]> {
  console.log('Fetching ALL QB bills to filter by project...');

  // Fetch all bills from QuickBooks
  const allBills = await paginatedQBQuery('SELECT * FROM Bill', 'Bill', tokens, userId);
  console.log(`Total QB bills fetched: ${allBills.length}`);

  // Filter to only bills that have the project CustomerRef in any line item
  // Bills with NO CustomerRef only included if they have exact amount + vendor match
  // Bills tagged to ancestor/parent customer only included if vendor is a known project vendor
  // When no project customer ID, filter by project vendor IDs only
  return filterBillsByProjectCustomer(allBills, projectCustomerId, procoreInvoiceRefs, projectVendorIds, ancestorCustomerIds);
}

// Fetch other QB data (invoices, payments) - filtered by project customer
async function fetchQBInvoicesAndPayments(
  tokens: QBTokenData,
  userId: string,
  projectName: string,
  projectCustomerId?: string | null
): Promise<{ invoices: any[]; paymentsReceived: any[]; matchedCustomer: string | null; matchedCustomerId: string | null }> {
  console.log('Fetching QB customers to find project match...');

  // First fetch all customers to find the best match for the project
  const customers = await paginatedQBQuery('SELECT * FROM Customer WHERE Active = true', 'Customer', tokens, userId);
  console.log(`Found ${customers.length} QB customers`);

  // Find best matching customer for this project (require higher threshold)
  let bestCustomer: { Id: string; DisplayName: string; score: number } | null = null;

  // If we already have a customer ID, use it
  if (projectCustomerId) {
    const customer = customers.find((c: any) => c.Id === projectCustomerId);
    if (customer) {
      bestCustomer = { Id: customer.Id, DisplayName: customer.DisplayName || customer.FullyQualifiedName || '', score: 100 };
    }
  }

  // Otherwise find by name matching (check both DisplayName and FQN)
  if (!bestCustomer) {
    for (const customer of customers) {
      const displayName = customer.DisplayName || '';
      const fqn = customer.FullyQualifiedName || '';
      const fqnNormalized = fqn.replace(/:/g, ' ');
      const displayScore = displayName ? fuzzyMatch(projectName, displayName) : 0;
      const fqnScore = fqnNormalized ? fuzzyMatch(projectName, fqnNormalized) : 0;
      const score = Math.max(displayScore, fqnScore);
      // Require at least 70% match for customer selection
      if (score >= 70 && (!bestCustomer || score > bestCustomer.score)) {
        bestCustomer = { Id: customer.Id, DisplayName: displayName || fqn, score };
      }
    }
  }

  if (bestCustomer) {
    console.log(`Matched project "${projectName}" to QB customer "${bestCustomer.DisplayName}" (ID: ${bestCustomer.Id}, score: ${bestCustomer.score})`);

    // Fetch ALL invoices for this customer (don't filter by amount - we want to catch discrepancies)
    const invoices = await paginatedQBQuery(
      `SELECT * FROM Invoice WHERE CustomerRef = '${bestCustomer.Id}'`,
      'Invoice',
      tokens,
      userId
    );
    console.log(`Found ${invoices.length} invoices for customer "${bestCustomer.DisplayName}"`);

    // ========== DEBUG: Log raw QB invoice structure ==========
    if (invoices.length > 0) {
      const inv1 = invoices[0];
      console.log('========== RAW QB INVOICE DEBUG ==========');
      console.log('QB INVOICE #1 - ALL KEYS:', Object.keys(inv1).join(', '));
      console.log('QB INVOICE #1 - FULL STRUCTURE:', JSON.stringify(inv1, null, 2));
      console.log('========== END QB INVOICE DEBUG ==========');
    }

    // Fetch payments for this customer
    const paymentsReceived = await paginatedQBQuery(
      `SELECT * FROM Payment WHERE CustomerRef = '${bestCustomer.Id}'`,
      'Payment',
      tokens,
      userId
    );
    console.log(`Found ${paymentsReceived.length} payments for customer "${bestCustomer.DisplayName}"`);

    return { invoices, paymentsReceived, matchedCustomer: bestCustomer.DisplayName, matchedCustomerId: bestCustomer.Id };
  } else {
    console.log(`No matching QB customer found for project "${projectName}"`);
    return { invoices: [], paymentsReceived: [], matchedCustomer: null, matchedCustomerId: null };
  }
}

// Labor account names to look for (partial match)
const LABOR_ACCOUNT_PATTERNS = [
  '5010', // Direct Labor Wages
  '5011', // Direct Labor Social Security Tax
  '5012', // Direct Labor Medicare Tax
];

// Fetch QB labor expenses for a project
// Queries Purchase transactions and filters by labor accounts and project CustomerRef
async function fetchQBLaborExpenses(
  tokens: QBTokenData,
  userId: string,
  projectCustomerId: string | null,
  ancestorCustomerIds: string[] = []
): Promise<QBLaborExpense[]> {
  console.log('Fetching QB labor expenses for accounts 5010-5012...');

  const laborExpenses: QBLaborExpense[] = [];
  const acceptableCustomerIds = new Set<string>();
  if (projectCustomerId) acceptableCustomerIds.add(projectCustomerId);
  for (const id of ancestorCustomerIds) acceptableCustomerIds.add(id);

  // First, find the labor account IDs
  const accounts = await paginatedQBQuery('SELECT * FROM Account WHERE Active = true', 'Account', tokens, userId);
  const laborAccountIds = new Set<string>();
  const laborAccountNames: Map<string, string> = new Map();

  for (const account of accounts) {
    const accountName = account.Name || '';
    const accountNum = account.AcctNum || '';
    // Match accounts by number prefix (5010, 5011, 5012) or by name containing "labor"
    const isLaborAccount = LABOR_ACCOUNT_PATTERNS.some(pattern =>
      accountNum.startsWith(pattern) || accountName.toLowerCase().includes('direct labor')
    );
    if (isLaborAccount) {
      laborAccountIds.add(account.Id);
      laborAccountNames.set(account.Id, `${accountNum} ${accountName}`.trim());
      console.log(`Found labor account: ${account.Id} - ${accountNum} ${accountName}`);
    }
  }

  if (laborAccountIds.size === 0) {
    console.log('No labor accounts found (5010, 5011, 5012)');
    return laborExpenses;
  }

  console.log(`Found ${laborAccountIds.size} labor accounts`);

  // Fetch Purchase transactions (checks, credit card charges, expenses)
  // Filter by CustomerRef if we have a project customer ID
  let purchaseQuery = 'SELECT * FROM Purchase';
  if (projectCustomerId) {
    // Note: QB Purchase transactions use EntityRef for customer/vendor
    // We'll fetch all and filter by line item CustomerRef
  }

  const purchases = await paginatedQBQuery(purchaseQuery, 'Purchase', tokens, userId);
  console.log(`Fetched ${purchases.length} Purchase transactions`);

  // Process purchases to find labor expenses
  // Track stats to understand filtering
  let totalLaborLineItems = 0;
  let lineItemsWithCustomer = 0;
  let lineItemsMatchingProject = 0;
  let lineItemsWithoutCustomer = 0;

  for (const purchase of purchases) {
    // Check line items for labor accounts
    for (const line of purchase.Line || []) {
      const detail = line.AccountBasedExpenseLineDetail;
      if (detail && laborAccountIds.has(detail.AccountRef?.value)) {
        totalLaborLineItems++;
        const lineCustomerId = detail.CustomerRef?.value;

        if (lineCustomerId) {
          lineItemsWithCustomer++;
          if (acceptableCustomerIds.has(lineCustomerId)) {
            lineItemsMatchingProject++;
          }
        } else {
          lineItemsWithoutCustomer++;
        }

        // Filter by project if we have a customer ID (accept exact match or ancestor match)
        if (projectCustomerId && (!lineCustomerId || !acceptableCustomerIds.has(lineCustomerId))) {
          continue;
        }

        laborExpenses.push({
          id: `${purchase.Id}-${line.Id || laborExpenses.length}`,
          accountName: laborAccountNames.get(detail.AccountRef.value) || 'Labor',
          accountId: detail.AccountRef.value,
          description: line.Description || 'Labor expense',
          amount: parseFloat(line.Amount || 0),
          date: purchase.TxnDate || '',
          customer: detail.CustomerRef?.name,
          customerId: lineCustomerId,
          txnType: purchase.PaymentType || 'Purchase',
        });
      }
    }
  }

  // Also check JournalEntry transactions for labor account debits
  const journalEntries = await paginatedQBQuery('SELECT * FROM JournalEntry', 'JournalEntry', tokens, userId);
  console.log(`Fetched ${journalEntries.length} JournalEntry transactions`);

  for (const je of journalEntries) {
    for (const line of je.Line || []) {
      const detail = line.JournalEntryLineDetail;
      if (detail && detail.PostingType === 'Debit' && laborAccountIds.has(detail.AccountRef?.value)) {
        totalLaborLineItems++;
        const lineCustomerId = detail.Entity?.EntityRef?.value;

        if (lineCustomerId) {
          lineItemsWithCustomer++;
          if (acceptableCustomerIds.has(lineCustomerId)) {
            lineItemsMatchingProject++;
          }
        } else {
          lineItemsWithoutCustomer++;
        }

        // Filter by project if we have a customer ID (accept exact match or ancestor match)
        if (projectCustomerId && (!lineCustomerId || !acceptableCustomerIds.has(lineCustomerId))) {
          continue;
        }

        laborExpenses.push({
          id: `JE-${je.Id}-${line.Id || laborExpenses.length}`,
          accountName: laborAccountNames.get(detail.AccountRef.value) || 'Labor',
          accountId: detail.AccountRef.value,
          description: line.Description || je.PrivateNote || 'Journal entry - Labor',
          amount: parseFloat(line.Amount || 0),
          date: je.TxnDate || '',
          customer: detail.Entity?.EntityRef?.name,
          customerId: lineCustomerId,
          txnType: 'JournalEntry',
        });
      }
    }
  }

  // Log labor expense filtering stats
  console.log(`Labor expense line item stats:`);
  console.log(`  Total labor account line items: ${totalLaborLineItems}`);
  console.log(`  With CustomerRef: ${lineItemsWithCustomer}`);
  console.log(`  Without CustomerRef: ${lineItemsWithoutCustomer}`);
  console.log(`  Matching project ${projectCustomerId}: ${lineItemsMatchingProject}`);

  console.log(`Found ${laborExpenses.length} labor expense line items for project`);
  const totalLabor = laborExpenses.reduce((sum, e) => sum + e.amount, 0);
  console.log(`Total QB labor expenses: $${totalLabor.toFixed(2)}`);

  return {
    expenses: laborExpenses,
    stats: {
      totalLaborLineItems,
      withCustomerRef: lineItemsWithCustomer,
      withoutCustomerRef: lineItemsWithoutCustomer,
      matchingProject: lineItemsMatchingProject,
    }
  };
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
  retainage: number; // Cumulative retainage held to date (total_retainage from Procore)
  retainageThisPeriod: number; // Per-invoice retainage held (computed from deltas)
  retainageReleased: number; // Per-invoice retainage released/billed back by sub
  retainageReleasedCumulative: number; // Cumulative retainage released to date (total_retainage_currently_released from Procore)
  workCompletedThisPeriod: number;
  workCompletedPrevious: number;
  materialsStored: number;
  totalCompletedAndStored: number;
}

interface ProcorePaymentApp {
  id: string;
  number: string;
  status: string;
  billingDate: string;
  totalAmount: number;
  approvedAmount: number;
  retainage: number; // Retainage held on this pay app
  netAmount: number; // Amount minus retainage
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

interface QBLaborExpense {
  id: string;
  accountName: string;
  accountId: string;
  description: string;
  amount: number;
  date: string;
  customer?: string;
  customerId?: string;
  txnType: string; // 'Purchase', 'Check', 'JournalEntry', etc.
}

interface MatchResult {
  id: string;
  matchType: 'invoice' | 'payment_app' | 'direct_cost' | 'commitment' | 'vendor_total' | 'labor';
  category: 'accounts_payable' | 'accounts_receivable' | 'direct_cost' | 'labor';
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
  // Phase 6: Retainage tracking
  procoreRetainage?: number;
  qbRetainage?: number;
  // Retention released and billing breakdown
  retainageReleased?: number;
  workCompletedThisPeriod?: number;
  workCompletedPrevious?: number;
  materialsStored?: number;
  totalCompletedAndStored?: number;
  // Payment app retainage fields (owner invoices)
  paymentAppRetainage?: number;
  // Billing date for period filtering
  billingDate?: string;
  // Submitted date (for Procore invoices)
  submittedDate?: string;
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

// Strip common company suffixes for better vendor name matching
function stripCompanySuffixes(str: string): string {
  if (!str) return '';
  // Common business suffixes and articles to remove
  // Order matters - process longer patterns first
  const suffixes = [
    /\b(the)\s+/gi,           // "The" at beginning
    /\s*(,?\s*)?(incorporated|inc\.?)$/gi,
    /\s*(,?\s*)?(l\.?l\.?c\.?|llc)$/gi,  // Handles LLC, L.L.C., etc.
    /\s*(,?\s*)?(limited|ltd\.?)$/gi,
    /\s*(,?\s*)?(corporation|corp\.?)$/gi,
    /\s*(,?\s*)?(company|co\.?)$/gi,
    /\s*(,?\s*)?(l\.?l\.?p\.?|llp)$/gi,  // Handles LLP, L.L.P., etc.
    /\s*(,?\s*)?(pllc\.?)$/gi,
    /\s*(,?\s*)?(p\.?c\.?)$/gi,
    /\s*(,?\s*)?(dba|d\/b\/a).*$/gi,
    /\s*(,?\s*)?(services|service)$/gi,  // Common construction suffix
    /\s*(,?\s*)?(contractors?|contracting)$/gi,  // Common construction suffix
  ];

  let result = str.trim();
  for (const suffix of suffixes) {
    result = result.replace(suffix, '');
  }
  return result.trim();
}

function fuzzyMatch(str1: string, str2: string): number {
  const s1 = normalizeString(str1);
  const s2 = normalizeString(str2);

  if (s1 === s2) return 100;
  if (s1.includes(s2) || s2.includes(s1)) return 85;

  // Strip company suffixes for better matching
  const stripped1 = stripCompanySuffixes(str1);
  const stripped2 = stripCompanySuffixes(str2);
  const s1Stripped = normalizeString(stripped1);
  const s2Stripped = normalizeString(stripped2);

  // Check if stripped versions match
  if (s1Stripped === s2Stripped) return 95;
  if (s1Stripped.includes(s2Stripped) || s2Stripped.includes(s1Stripped)) return 85;

  // Word-based matching (Jaccard similarity) - use stripped versions
  const words1 = new Set(stripped1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(stripped2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const intersection = [...words1].filter(w => words2.has(w));
  const union = new Set([...words1, ...words2]);

  if (union.size === 0) return 0;
  const wordScore = Math.round((intersection.length / union.size) * 100);

  // Levenshtein distance for better string similarity - use stripped versions
  const levenshteinScore = calculateLevenshteinSimilarity(s1Stripped, s2Stripped);

  return Math.max(wordScore, levenshteinScore);
}

// Calculate Levenshtein distance and convert to similarity percentage
function calculateLevenshteinSimilarity(s1: string, s2: string): number {
  if (s1.length === 0 && s2.length === 0) return 100;
  if (s1.length === 0 || s2.length === 0) return 0;

  // Create distance matrix
  const matrix: number[][] = [];
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the matrix
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  const distance = matrix[s1.length][s2.length];
  const maxLength = Math.max(s1.length, s2.length);
  const similarity = Math.round(((maxLength - distance) / maxLength) * 100);

  return similarity;
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

  // "Reconciled" (info) ONLY if amounts match exactly (within $1 tolerance for rounding)
  // Any variance beyond $1 is at minimum a warning
  if (absVariance >= 5000 || pct >= 0.10) return 'critical';
  if (absVariance >= 1) return 'warning';  // Changed: any variance > $1 is a warning
  return 'info';  // Only exact matches (< $1 variance) are "Reconciled"
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
    // Debug: Log ALL financial fields to find the correct paid amount field
    console.log('Subcontract FINANCIAL fields:', JSON.stringify({
      grand_total: firstSub.grand_total,
      original_value: firstSub.original_value,
      revised_value: firstSub.revised_value,
      invoiced_amount: firstSub.invoiced_amount,
      bill_amount: firstSub.bill_amount,
      payment_amount: firstSub.payment_amount,
      paid_amount: firstSub.paid_amount,
      paid_to_date: firstSub.paid_to_date,
      total_payments: firstSub.total_payments,
      retention_amount: firstSub.retention_amount,
      held_retention: firstSub.held_retention,
      // Check for nested financial summary
      financial_summary: firstSub.financial_summary,
      summary: firstSub.summary,
      totals: firstSub.totals,
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
      currentValue: parseFloat(sub.revised_value || 0)
        || (parseFloat(sub.grand_total || sub.original_value || 0)
          + parseFloat(sub.approved_change_orders || sub.change_order_approved_amount || 0)),
      billedToDate: parseFloat(sub.invoiced_amount || sub.bill_amount || 0),
      paidToDate: parseFloat(sub.total_payments || sub.payment_amount || sub.paid_amount || 0),
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
      currentValue: parseFloat(po.revised_value || 0)
        || (parseFloat(po.grand_total || po.original_value || 0)
          + parseFloat(po.approved_change_orders || 0)),
      billedToDate: parseFloat(po.invoiced_amount || po.bill_amount || 0),
      paidToDate: parseFloat(po.total_payments || po.payment_amount || po.paid_amount || 0),
      retentionHeld: 0,
    });
  }

  return commitments;
}

function normalizeProcoreInvoices(procoreData: any): ProcoreInvoice[] {
  const invoices: ProcoreInvoice[] = [];

  // Debug: Log first invoice to see ALL amount-related fields
  const firstInv = procoreData.subInvoices?.[0];
  if (firstInv) {
    console.log('=== NORMALIZING INVOICE DEBUG ===');
    console.log('All invoice keys:', Object.keys(firstInv).join(', '));
console.log('Sample invoice AMOUNTS:', JSON.stringify({
      id: firstInv.id,
      number: firstInv.number,
      vendor_name: firstInv.vendor_name,
      total_claimed_amount: firstInv.total_claimed_amount,
      total_retainage: firstInv.total_retainage,
      retainage_released_amount: firstInv.retainage_released_amount,
      total_retainage_currently_released: firstInv.total_retainage_currently_released,
    }, null, 2));
    // Log the summary and payment_summary objects which likely contain invoice totals
    console.log('INVOICE SUMMARY OBJECT:', JSON.stringify(firstInv.summary, null, 2));
    console.log('INVOICE PAYMENT_SUMMARY OBJECT:', JSON.stringify(firstInv.payment_summary, null, 2));
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
      // Use payment_summary.invoiced_amount_due for invoice total (not total_claimed_amount which is "Work Completed This Period")
      amount: parseFloat(inv.payment_summary?.invoiced_amount_due || inv.summary?.current_payment_due || inv.total_claimed_amount || 0),
      billingDate: inv.billing_date || inv.invoice_date || '',
      paymentDue: parseFloat(inv.payment_due || inv.balance || 0),
      // Cumulative retainage held to date (from Procore's running total fields)
      retainage: parseFloat(
        inv.total_retainage
        || inv.total_completed_work_retainage_to_date
        || inv.summary?.total_retainage
        || inv.summary?.completed_work_retainage_amount
        || 0
      ),
      retainageThisPeriod: 0, // Computed after normalization via computePerInvoiceRetainage()
      // Per-period retainage released
      retainageReleased: parseFloat(
        inv.retainage_released_amount
        || inv.payment_summary?.retainage_released
        || inv.summary?.retainage_released
        || 0
      ),
      // Cumulative retainage released to date (used to compute per-period if per-period fields are unavailable)
      retainageReleasedCumulative: parseFloat(
        inv.total_retainage_currently_released
        || inv.summary?.total_retainage_currently_released
        || inv.payment_summary?.total_retainage_currently_released
        || 0
      ),
      // Billing breakdown fields (G702 / AIA format)
      workCompletedThisPeriod: parseFloat(inv.work_completed_this_period || inv.total_claimed_amount || 0),
      workCompletedPrevious: parseFloat(inv.work_completed_from_previous_application || 0),
      materialsStored: parseFloat(inv.materials_presently_stored || inv.total_materials_presently_stored || 0),
      totalCompletedAndStored: parseFloat(inv.total_completed_and_stored_to_date || inv.g702_total_completed_and_stored_to_date || 0),
    });
  }

  return invoices;
}

// Compute per-invoice retainage from cumulative totals.
// Procore's total_retainage is a running total across all invoices for a
// commitment. To get per-invoice retainage, group by commitmentId, sort
// chronologically, and compute deltas.
function computePerInvoiceRetainage(invoices: ProcoreInvoice[]): void {
  const byCommitment = new Map<string, ProcoreInvoice[]>();
  for (const inv of invoices) {
    const key = inv.commitmentId || inv.vendor; // Fall back to vendor if no commitmentId
    if (!byCommitment.has(key)) byCommitment.set(key, []);
    byCommitment.get(key)!.push(inv);
  }

  for (const [, group] of byCommitment) {
    // Sort by billing date ascending
    group.sort((a, b) => (a.billingDate || '').localeCompare(b.billingDate || ''));

    let prevCumulativeRetainage = 0;
    for (const inv of group) {
      // Per-period retainage = change in cumulative + any released this period
      // Because: cumulative[i] = cumulative[i-1] + newHeld[i] - released[i]
      // So: newHeld[i] = cumulative[i] - cumulative[i-1] + released[i]
      const newRetainage = inv.retainage - prevCumulativeRetainage + inv.retainageReleased;
      inv.retainageThisPeriod = Math.max(newRetainage, 0); // Guard against negative from data quirks
      prevCumulativeRetainage = inv.retainage;
    }
  }
}

// Compute per-invoice retainage released from cumulative totals.
// Three strategies, tried in order:
// 1. Per-period retainageReleased already populated from API → do nothing
// 2. Cumulative retainageReleasedCumulative exists → derive per-period from deltas
// 3. No explicit released data → infer releases from DROPS in cumulative retainage
//    (total_retainage). When cumulative retainage decreases between sequential
//    invoices for a commitment, the drop = retainage that was released.
function computePerInvoiceRetainageReleased(invoices: ProcoreInvoice[]): void {
  // Strategy 1: per-period values already populated
  const hasPerPeriodValues = invoices.some(inv => inv.retainageReleased > 0);
  if (hasPerPeriodValues) return;

  const byCommitment = new Map<string, ProcoreInvoice[]>();
  for (const inv of invoices) {
    const key = inv.commitmentId || inv.vendor;
    if (!byCommitment.has(key)) byCommitment.set(key, []);
    byCommitment.get(key)!.push(inv);
  }

  // Strategy 2: derive from cumulative released field
  const hasCumulativeValues = invoices.some(inv => inv.retainageReleasedCumulative > 0);
  if (hasCumulativeValues) {
    console.log('Per-period retainage released not available; computing from cumulative released totals');
    for (const [, group] of byCommitment) {
      group.sort((a, b) => (a.billingDate || '').localeCompare(b.billingDate || ''));
      let prevCumulativeReleased = 0;
      for (const inv of group) {
        const released = inv.retainageReleasedCumulative - prevCumulativeReleased;
        inv.retainageReleased = Math.max(released, 0);
        prevCumulativeReleased = inv.retainageReleasedCumulative;
      }
    }
    return;
  }

  // Strategy 3: infer from drops in cumulative retainage held.
  // When cumulative retainage (total_retainage) decreases between invoices,
  // the decrease represents retainage that was released/paid back.
  // Formula: released[i] = max(cumRetainage[i-1] - cumRetainage[i], 0)
  // This correctly feeds into computePerInvoiceRetainage() which uses:
  //   newHeld = cumulative[i] - cumulative[i-1] + released[i]
  // When released = |drop|: newHeld = drop + |drop| = 0 (correct for release invoices)
  // When released = 0: newHeld = rise (correct for normal invoices)
  const hasRetainageData = invoices.some(inv => inv.retainage > 0);
  if (!hasRetainageData) return; // No retainage data at all

  console.log('No explicit retainage released data; inferring releases from drops in cumulative retainage held');

  let totalInferred = 0;
  for (const [, group] of byCommitment) {
    group.sort((a, b) => (a.billingDate || '').localeCompare(b.billingDate || ''));

    let prevCumulativeRetainage = 0;
    for (const inv of group) {
      const drop = prevCumulativeRetainage - inv.retainage;
      if (drop > 0) {
        inv.retainageReleased = drop;
        totalInferred += drop;
        console.log(`  Inferred retainage released for ${inv.vendor} inv #${inv.number}: $${drop.toFixed(2)} (cumulative dropped from $${prevCumulativeRetainage.toFixed(2)} to $${inv.retainage.toFixed(2)})`);
      }
      prevCumulativeRetainage = inv.retainage;
    }
  }

  if (totalInferred > 0) {
    console.log(`Total inferred retainage released: $${totalInferred.toFixed(2)}`);
  }
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

    // Retainage from payment application summary
    const retainage = parseFloat(
      app.summary?.total_retainage ||
      app.total_retainage ||
      app.retainage_amount ||
      0
    );

    // Net amount = total minus retainage (current_payment_due)
    const netAmount = parseFloat(
      app.summary?.current_payment_due ||
      app.current_payment_due ||
      0
    ) || (totalAmt - retainage);

    apps.push({
      id: String(app.id),
      number: app.number || String(app.id),
      status: app.status || '',
      billingDate: app.billing_date || '',
      totalAmount: totalAmt,
      approvedAmount: parseFloat(app.approved_amount || totalAmt || 0),
      retainage,
      netAmount,
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

  // First pass: try to find exact match after stripping suffixes
  const strippedProcore = stripCompanySuffixes(procoreVendor).toLowerCase().trim();
  for (const qbVendor of qbVendors) {
    const strippedQB = stripCompanySuffixes(qbVendor.DisplayName).toLowerCase().trim();
    if (strippedProcore === strippedQB) {
      console.log(`VENDOR EXACT MATCH (after stripping): "${procoreVendor}" -> "${qbVendor.DisplayName}"`);
      return { name: qbVendor.DisplayName, id: qbVendor.Id, score: 100 };
    }
  }

  // Second pass: fuzzy matching
  for (const qbVendor of qbVendors) {
    const score = fuzzyMatch(procoreVendor, qbVendor.DisplayName);
    if (score >= 60 && (!best || score > best.score)) {  // Lowered threshold from 65 to 60
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
            // VALIDATE: Check that the AI match actually makes sense
            // Use fuzzy matching to verify the AI didn't hallucinate
            const validationScore = fuzzyMatch(match.procore, qbVendor.DisplayName);
            if (validationScore >= 50) {
              vendorMap.set(match.procore, {
                name: qbVendor.DisplayName,
                id: qbVendor.Id,
                score: match.confidence,
              });
            } else {
              console.log(`AI match rejected (validation failed): "${match.procore}" → "${qbVendor.DisplayName}" (fuzzy score: ${validationScore})`);
            }
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
  const fuzzyResult = findBestVendorMatch(procoreVendor, qbVendors);

  // Debug: log when fuzzy matching fails for vendors that look similar
  if (!fuzzyResult) {
    // Find best partial match for debugging
    let bestScore = 0;
    let bestName = '';
    for (const qbVendor of qbVendors) {
      const score = fuzzyMatch(procoreVendor, qbVendor.DisplayName);
      if (score > bestScore) {
        bestScore = score;
        bestName = qbVendor.DisplayName;
      }
    }
    if (bestScore > 40) {
      console.log(`VENDOR MATCH FAILED: "${procoreVendor}" best match was "${bestName}" with score ${bestScore} (threshold: 65)`);
    }
  }

  return fuzzyResult;
}

// Match Procore sub invoices to QuickBooks bills
function matchInvoicesToBills(
  procoreInvoices: ProcoreInvoice[],
  qbBills: QBBill[],
  qbVendors: any[],
  aiVendorMap: Map<string, { name: string; id: string; score: number }>,
  vendorEquivalenceMap: Map<string, Set<string>> = new Map()
): { results: MatchResult[]; matchedQBBillIds: Set<string>; matchedProcoreIds: Set<string> } {
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
        procoreRetainage: pInv.retainageThisPeriod || 0,
        retainageReleased: pInv.retainageReleased || 0,
        workCompletedThisPeriod: pInv.workCompletedThisPeriod || 0,
        workCompletedPrevious: pInv.workCompletedPrevious || 0,
        materialsStored: pInv.materialsStored || 0,
        totalCompletedAndStored: pInv.totalCompletedAndStored || 0,
        billingDate: pInv.billingDate || undefined,
      });
      continue;
    }

    // Find matching bills for this vendor (include LLC/Inc/Corp equivalents)
    const equivalentIds = vendorEquivalenceMap.get(vendorMatch.id) || new Set([vendorMatch.id]);
    const vendorBills = qbBills.filter(
      b => equivalentIds.has(b.vendorId) && !matchedQBBillIds.has(b.id)
    );

    // Try to find exact or close match
    let bestBill: QBBill | null = null;
    let bestScore = 0;
    let matchMethod = '';

    // Gross Procore amount (net + per-invoice retainage) for retainage-aware matching.
    // QB bills typically include retainage in TotalAmt, while Procore's
    // invoice amount is net-of-retainage (current_payment_due).
    const grossProcoreAmount = pInv.amount + (pInv.retainageThisPeriod || 0);
    let bestMatchIsGross = false;

    for (const bill of vendorBills) {
      let score = 0;
      let isGrossMatch = false;

      // Exact amount match (net-to-net)
      if (amountMatches(pInv.amount, bill.amount, 0.001)) {
        score += 50;
        matchMethod = 'amount_match';
      } else if (pInv.retainageThisPeriod > 0 && amountMatches(grossProcoreAmount, bill.amount, 0.001)) {
        // Gross match: QB bill includes retainage in its total
        score += 50;
        matchMethod = 'amount_match_gross';
        isGrossMatch = true;
      } else if (amountMatches(pInv.amount, bill.amount, 0.05)) {
        score += 30;
        matchMethod = 'amount_close';
      } else if (pInv.retainageThisPeriod > 0 && amountMatches(grossProcoreAmount, bill.amount, 0.05)) {
        score += 30;
        matchMethod = 'amount_close_gross';
        isGrossMatch = true;
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
        bestMatchIsGross = isGrossMatch;
      }
    }

    // Reject matches where amounts are wildly different even if doc numbers matched.
    // A doc-number-only match (score=40) with amounts off by >50% is likely a false positive
    // (e.g. matching a $5,900 invoice to a $400 bill just because doc numbers collide).
    if (bestBill && bestScore >= 40) {
      const amtDiffPct = Math.abs(pInv.amount - bestBill.amount) / Math.max(pInv.amount, bestBill.amount, 1);
      const grossDiffPct = grossProcoreAmount > 0
        ? Math.abs(grossProcoreAmount - bestBill.amount) / Math.max(grossProcoreAmount, bestBill.amount, 1)
        : amtDiffPct;
      const hasAmountMatch = matchMethod.includes('amount');
      if (!hasAmountMatch && Math.min(amtDiffPct, grossDiffPct) > 0.50) {
        console.log(`Rejecting doc-number-only match for ${pInv.vendor} inv #${pInv.number}: Procore $${pInv.amount} vs QB $${bestBill.amount} (${(amtDiffPct * 100).toFixed(0)}% diff)`);
        bestBill = null;
        bestScore = 0;
      }
    }

    if (bestBill && bestScore >= 40) {
      matchedQBBillIds.add(bestBill.id);
      matchedProcoreIds.add(pInv.id);

      // When QB bill includes retainage in its total (gross match), compare
      // on a gross-to-gross basis so retainage doesn't create a false variance.
      const comparableProcore = bestMatchIsGross ? grossProcoreAmount : pInv.amount;
      const variance = comparableProcore - bestBill.amount;

      // QB retainage: derive from match type.
      // Gross match: QB bill includes retainage in its total, so the retainage
      // portion = bill amount minus Procore net amount.
      // Net match: QB bill is net-of-retainage but retainage still exists
      // contractually — use Procore's per-period retainage so the summary
      // "Retention Held" row reflects the actual retainage for both systems.
      const retainageInQB = bestMatchIsGross
        ? Math.max(bestBill.amount - pInv.amount, 0)
        : (pInv.retainageThisPeriod || 0);
      const procoreRetainagePeriod = pInv.retainageThisPeriod || 0;

      const retainageNote = procoreRetainagePeriod > 0
        ? bestMatchIsGross
          ? ` (QB bill includes $${retainageInQB.toFixed(2)} retainage)`
          : ` (retainage: $${procoreRetainagePeriod.toFixed(2)})`
        : '';
      results.push({
        id: generateId(),
        matchType: 'invoice',
        category: 'accounts_payable',
        description: `Sub Invoice #${pInv.number || pInv.id}`,
        vendor: pInv.vendor,
        customer: null,
        procoreRef: `Invoice ${pInv.number || pInv.id}`,
        qbRef: `Bill ${bestBill.docNumber || bestBill.id}`,
        procoreValue: bestMatchIsGross ? grossProcoreAmount : pInv.amount,
        qbValue: bestBill.amount,
        variance,
        variancePct: comparableProcore ? (variance / comparableProcore) * 100 : 0,
        matchConfidence: Math.min(bestScore, 100),
        matchMethod,
        severity: calculateSeverity(variance, comparableProcore),
        status: Math.abs(variance) < 1 ? 'matched' : 'partial',
        notes: Math.abs(variance) < 1
          ? `Matched to QB Bill #${bestBill.docNumber}${retainageNote}`
          : `Variance of $${Math.abs(variance).toFixed(2)} with QB Bill #${bestBill.docNumber}${retainageNote}`,
        procoreDate: pInv.billingDate,
        qbDate: bestBill.date,
        requiresAction: Math.abs(variance) >= 100,
        procoreRetainage: procoreRetainagePeriod,
        qbRetainage: retainageInQB,
        retainageReleased: pInv.retainageReleased || 0,
        workCompletedThisPeriod: pInv.workCompletedThisPeriod || 0,
        workCompletedPrevious: pInv.workCompletedPrevious || 0,
        materialsStored: pInv.materialsStored || 0,
        totalCompletedAndStored: pInv.totalCompletedAndStored || 0,
        billingDate: pInv.billingDate || undefined,
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
        notes: `No matching bill found in QuickBooks for vendor "${pInv.vendor}" - may not be entered yet`,
        procoreDate: pInv.billingDate,
        requiresAction: true,
        procoreRetainage: pInv.retainageThisPeriod || 0,
        retainageReleased: pInv.retainageReleased || 0,
        workCompletedThisPeriod: pInv.workCompletedThisPeriod || 0,
        workCompletedPrevious: pInv.workCompletedPrevious || 0,
        materialsStored: pInv.materialsStored || 0,
        totalCompletedAndStored: pInv.totalCompletedAndStored || 0,
      });
    }
  }

  return { results, matchedQBBillIds, matchedProcoreIds };
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
      // Compare net amount (minus retainage) to QB invoice amount
      const procoreNetAmount = app.netAmount || app.approvedAmount;
      const variance = procoreNetAmount - bestMatch.amount;

      results.push({
        id: generateId(),
        matchType: 'payment_app',
        category: 'accounts_receivable',
        description: `Payment Application #${app.number}`,
        vendor: null,
        customer: bestMatch.customer,
        procoreRef: `Pay App #${app.number}`,
        qbRef: `Invoice #${bestMatch.docNumber || bestMatch.id}`,
        procoreValue: procoreNetAmount,
        qbValue: bestMatch.amount,
        variance,
        variancePct: procoreNetAmount ? (variance / procoreNetAmount) * 100 : 0,
        matchConfidence: bestScore,
        matchMethod: 'amount_date',
        severity: calculateSeverity(variance, procoreNetAmount),
        status: Math.abs(variance) < 1 ? 'matched' : 'partial',
        notes: Math.abs(variance) < 1
          ? `Matched to QB Invoice #${bestMatch.docNumber}`
          : `Variance of $${Math.abs(variance).toFixed(2)}`,
        procoreDate: app.billingDate,
        qbDate: bestMatch.date,
        requiresAction: Math.abs(variance) >= 500,
        paymentAppRetainage: app.retainage || 0,
        billingDate: app.billingDate,
      });
    } else {
      const procoreNetAmount = app.netAmount || app.approvedAmount;
      results.push({
        id: generateId(),
        matchType: 'payment_app',
        category: 'accounts_receivable',
        description: `Payment Application #${app.number}`,
        vendor: null,
        customer: null,
        procoreRef: `Pay App #${app.number}`,
        qbRef: null,
        procoreValue: procoreNetAmount,
        qbValue: null,
        variance: procoreNetAmount,
        variancePct: 100,
        matchConfidence: 0,
        matchMethod: 'none',
        severity: calculateSeverity(procoreNetAmount, procoreNetAmount),
        status: 'timing',
        notes: 'No matching customer invoice found in QuickBooks - may not be entered yet',
        procoreDate: app.billingDate,
        requiresAction: true,
        paymentAppRetainage: app.retainage || 0,
        billingDate: app.billingDate,
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
  aiVendorMap: Map<string, { name: string; id: string; score: number }>,
  vendorEquivalenceMap: Map<string, Set<string>> = new Map()
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

    // Find matching bill (include LLC/Inc/Corp equivalents)
    const equivalentIds = vendorEquivalenceMap.get(vendorMatch.id) || new Set([vendorMatch.id]);
    const vendorBills = qbBills.filter(
      b => equivalentIds.has(b.vendorId) && !matchedBillIds.has(b.id)
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
        notes: `No matching bill found for vendor "${dc.vendor}"`,
        procoreDate: dc.date,
        requiresAction: true,
      });
    }
  }

  return results;
}

// Check if a direct cost is a payroll/labor cost
function isLaborDirectCost(dc: ProcoreDirectCost): boolean {
  const desc = dc.description.toLowerCase();
  return desc.includes('payroll') ||
    desc.includes('labor') ||
    desc.includes('wages') ||
    desc.includes('salary') ||
    desc.includes('worker') ||
    desc.includes('employee') ||
    desc.includes('general conditions'); // GC typically represents self-performed labor
}

// Match Procore payroll direct costs to QB labor expenses
function matchLaborCosts(
  directCosts: ProcoreDirectCost[],
  qbLaborExpenses: QBLaborExpense[]
): { laborResults: MatchResult[]; nonLaborDirectCosts: ProcoreDirectCost[] } {
  const laborResults: MatchResult[] = [];
  const nonLaborDirectCosts: ProcoreDirectCost[] = [];

  // Separate labor from non-labor direct costs
  const laborDirectCosts = directCosts.filter(isLaborDirectCost);
  nonLaborDirectCosts.push(...directCosts.filter(dc => !isLaborDirectCost(dc)));

  console.log(`Labor matching: ${laborDirectCosts.length} Procore payroll costs, ${qbLaborExpenses.length} QB labor expenses`);

  // Calculate totals for summary matching
  const procoreLaborTotal = laborDirectCosts.reduce((sum, dc) => sum + dc.amount, 0);
  const qbLaborTotal = qbLaborExpenses.reduce((sum, e) => sum + e.amount, 0);

  // If no labor on either side, return early
  if (laborDirectCosts.length === 0 && qbLaborExpenses.length === 0) {
    return { laborResults, nonLaborDirectCosts };
  }

  // Create results for each Procore payroll cost
  for (const dc of laborDirectCosts) {
    // Try to find a matching QB labor expense by date and approximate amount
    let bestMatch: QBLaborExpense | null = null;
    let bestScore = 0;

    for (const qbLabor of qbLaborExpenses) {
      let score = 0;

      // Check amount match (within 5% or $10)
      const amountDiff = Math.abs(dc.amount - qbLabor.amount);
      const pctDiff = dc.amount > 0 ? amountDiff / dc.amount : 1;
      if (pctDiff <= 0.05 || amountDiff <= 10) {
        score += 60;
      } else if (pctDiff <= 0.15 || amountDiff <= 50) {
        score += 30;
      }

      // Check date proximity (within 7 days)
      if (dc.date && qbLabor.date) {
        const dcDate = new Date(dc.date);
        const qbDate = new Date(qbLabor.date);
        const daysDiff = Math.abs((dcDate.getTime() - qbDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff <= 3) {
          score += 30;
        } else if (daysDiff <= 7) {
          score += 15;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = qbLabor;
      }
    }

    if (bestMatch && bestScore >= 50) {
      const variance = dc.amount - bestMatch.amount;
      const variancePct = dc.amount > 0 ? (variance / dc.amount) * 100 : 0;

      laborResults.push({
        id: generateId(),
        matchType: 'labor',
        category: 'labor',
        description: dc.description || 'Payroll/Labor',
        vendor: dc.vendor || null,
        customer: null,
        procoreRef: dc.invoiceNumber || `DC-${dc.id}`,
        qbRef: `${bestMatch.accountName} - ${bestMatch.txnType}`,
        procoreValue: dc.amount,
        qbValue: bestMatch.amount,
        variance,
        variancePct: Math.abs(variancePct),
        matchConfidence: bestScore,
        matchMethod: 'labor_match',
        severity: Math.abs(variancePct) <= 1 ? 'info' : Math.abs(variance) > 500 ? 'critical' : 'warning',
        status: Math.abs(variancePct) <= 1 ? 'matched' : 'partial',
        notes: Math.abs(variancePct) <= 1
          ? 'Labor costs match'
          : `Labor variance of $${Math.abs(variance).toFixed(2)}`,
        procoreDate: dc.date,
        qbDate: bestMatch.date,
        requiresAction: Math.abs(variance) > 100,
      });
    } else {
      // No QB match found
      laborResults.push({
        id: generateId(),
        matchType: 'labor',
        category: 'labor',
        description: dc.description || 'Payroll/Labor',
        vendor: dc.vendor || null,
        customer: null,
        procoreRef: dc.invoiceNumber || `DC-${dc.id}`,
        qbRef: null,
        procoreValue: dc.amount,
        qbValue: null,
        variance: dc.amount,
        variancePct: 100,
        matchConfidence: 0,
        matchMethod: 'no_match',
        severity: 'warning',
        status: 'unmatched_procore',
        notes: 'No matching QB labor expense found',
        procoreDate: dc.date,
        requiresAction: true,
      });
    }
  }

  // Add QB labor expenses that weren't matched to Procore
  const matchedQBIds = new Set(laborResults.filter(r => r.qbRef).map(r => r.qbRef));
  for (const qbLabor of qbLaborExpenses) {
    const qbRef = `${qbLabor.accountName} - ${qbLabor.txnType}`;
    // Only add if not already matched (check by creating a unique ID)
    const isMatched = laborResults.some(r =>
      r.qbValue === qbLabor.amount && r.qbDate === qbLabor.date
    );

    if (!isMatched) {
      laborResults.push({
        id: generateId(),
        matchType: 'labor',
        category: 'labor',
        description: qbLabor.description || 'QB Labor Expense',
        vendor: null,
        customer: qbLabor.customer || null,
        procoreRef: null,
        qbRef,
        procoreValue: null,
        qbValue: qbLabor.amount,
        variance: -qbLabor.amount,
        variancePct: 100,
        matchConfidence: 0,
        matchMethod: 'qb_only',
        severity: 'warning',
        status: 'unmatched_qb',
        notes: 'QB labor expense not found in Procore',
        qbDate: qbLabor.date,
        requiresAction: true,
      });
    }
  }

  console.log(`Labor matching complete: ${laborResults.length} results, Procore=$${procoreLaborTotal.toFixed(2)}, QB=$${qbLaborTotal.toFixed(2)}`);

  return { laborResults, nonLaborDirectCosts };
}

// Find unmatched QB bills - only include bills from vendors that have Procore
// commitments/invoices on this project to avoid pulling in other projects' bills
function findUnmatchedQBBills(
  qbBills: QBBill[],
  matchedQBIds: Set<string>,
  commitments: ProcoreCommitment[],
  qbVendors: any[],
  aiVendorMap: Map<string, { name: string; id: string; score: number }>,
  projectVendorIds: Set<string> = new Set()
): MatchResult[] {
  const results: MatchResult[] = [];

  // Build a set of vendors that have subcontracts (strip suffixes to merge LLC/Inc/Corp variants)
  const subcontractVendors = new Set<string>();
  for (const c of commitments) {
    if (c.type === 'subcontract') {
      subcontractVendors.add(stripCompanySuffixes(c.vendor).toLowerCase().trim());
    }
  }

  // Also add AI-mapped vendor names for subcontract vendors (stripped)
  for (const c of commitments) {
    if (c.type === 'subcontract') {
      const aiMatch = aiVendorMap.get(c.vendor);
      if (aiMatch) {
        subcontractVendors.add(stripCompanySuffixes(aiMatch.name).toLowerCase().trim());
      }
    }
  }

  // Only include unmatched QB bills from vendors with Procore presence on this project
  // This prevents bills from other projects (same customer) from flooding results
  let skippedNonProjectVendors = 0;
  for (const bill of qbBills) {
    if (matchedQBIds.has(bill.id)) continue;

    // Skip bills from vendors not associated with this project
    if (projectVendorIds.size > 0 && !projectVendorIds.has(bill.vendorId)) {
      skippedNonProjectVendors++;
      continue;
    }

    // Check if this vendor has a subcontract (use stripped name for comparison)
    const billVendorStripped = stripCompanySuffixes(bill.vendor).toLowerCase().trim();
    const hasSubcontract = subcontractVendors.has(billVendorStripped) ||
      [...subcontractVendors].some(sv => {
        const score = fuzzyMatch(billVendorStripped, sv);
        return score >= 65;
      });

    // Build detailed notes with all QB data
    const detailParts = [
      `Date: ${bill.date || 'N/A'}`,
      `Due: ${bill.dueDate || 'N/A'}`,
      `Balance: $${bill.balance?.toFixed(2) || '0.00'}`,
    ];
    if (bill.memo) {
      detailParts.push(`Memo: ${bill.memo}`);
    }

    // Categorize based on whether vendor has a subcontract
    const matchType = hasSubcontract ? 'invoice' : 'direct_cost';
    const description = hasSubcontract
      ? `QB Bill #${bill.docNumber || bill.id} - ${bill.vendor} - $${bill.amount.toFixed(2)}`
      : `Direct Cost: ${bill.vendor} - $${bill.amount.toFixed(2)}`;

    results.push({
      id: generateId(),
      matchType,
      category: 'accounts_payable',
      description,
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
      notes: `QB Only | ${detailParts.join(' | ')}`,
      qbDate: bill.date,
      requiresAction: bill.amount >= 500,
    });
  }

  const subInvoiceCount = results.filter(r => r.matchType === 'invoice').length;
  const directCostCount = results.filter(r => r.matchType === 'direct_cost').length;
  console.log(`Found ${results.length} unmatched QB bills: ${subInvoiceCount} sub invoices, ${directCostCount} direct costs (skipped ${skippedNonProjectVendors} bills from non-project vendors)`);
  return results;
}

// Vendor-level totals reconciliation
function reconcileVendorTotals(
  commitments: ProcoreCommitment[],
  qbBills: QBBill[],
  qbVendors: any[],
  aiVendorMap: Map<string, { name: string; id: string; score: number }>,
  vendorEquivalenceMap: Map<string, Set<string>> = new Map()
): MatchResult[] {
  const results: MatchResult[] = [];

  // Group commitments by matched QB vendor ID (or suffix-stripped name if no match)
  // This prevents LLC/Inc/Corp variants from creating duplicate vendor entries
  const commitmentsByVendor = new Map<string, { comms: ProcoreCommitment[]; matchedVendor: { name: string; id: string; score: number } | null }>();
  for (const c of commitments) {
    const match = findVendorMatch(c.vendor, qbVendors, aiVendorMap);
    const key = match ? `qb:${match.id}` : stripCompanySuffixes(c.vendor).toLowerCase().trim();
    if (!commitmentsByVendor.has(key)) {
      commitmentsByVendor.set(key, { comms: [], matchedVendor: match });
    }
    commitmentsByVendor.get(key)!.comms.push(c);
  }

  // Group QB bills by vendor ID for reliable lookup
  const billsByVendorId = new Map<string, QBBill[]>();
  for (const b of qbBills) {
    const key = b.vendorId;
    if (!billsByVendorId.has(key)) billsByVendorId.set(key, []);
    billsByVendorId.get(key)!.push(b);
  }

  for (const [vendorKey, { comms, matchedVendor }] of commitmentsByVendor) {
    const procoreTotal = comms.reduce((sum, c) => sum + c.currentValue, 0);
    const procoreBilled = comms.reduce((sum, c) => sum + c.billedToDate, 0);
    const vendorName = comms[0].vendor;

    if (!matchedVendor) {
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

    // Include bills from equivalent vendor IDs (LLC/Inc/Corp variants)
    const equivalentIds = vendorEquivalenceMap.get(matchedVendor.id) || new Set([matchedVendor.id]);
    const vendorBills: QBBill[] = [];
    for (const eqId of equivalentIds) {
      const bills = billsByVendorId.get(eqId);
      if (bills) vendorBills.push(...bills);
    }
    if (!vendorEquivalenceMap.has(matchedVendor.id)) {
      const directBills = billsByVendorId.get(matchedVendor.id);
      if (directBills) vendorBills.push(...directBills);
    }
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
      matchConfidence: matchedVendor.score,
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

  // Critical variances (skip vendor_total since those are aggregate summaries —
  // individual invoice/direct_cost results already capture line-level discrepancies)
  for (const r of matchResults) {
    if (r.severity === 'critical' && r.status !== 'matched' && r.matchType !== 'vendor_total') {
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

  // Unmatched Procore items needing action (QB bills from other projects are excluded)
  for (const r of matchResults) {
    // Only create closeout items for unmatched PROCORE items (not QB items)
    // QB items may be from other projects so we don't want to count them as exposure
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
    // Note: We don't create closeout items for unmatched_qb because we can't
    // reliably determine if they're for this project (vendors work across projects)
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

    // ========== DEBUG: Log raw Procore invoice data ==========
    console.log('========== RAW PROCORE INVOICE DEBUG ==========');
    console.log(`Total sub invoices received: ${procoreData.subInvoices?.length || 0}`);
    if (procoreData.subInvoices && procoreData.subInvoices.length > 0) {
      const inv1 = procoreData.subInvoices[0];
      console.log('INVOICE #1 - ALL KEYS:', Object.keys(inv1).join(', '));
      console.log('INVOICE #1 - ALL AMOUNT FIELDS:', JSON.stringify({
        number: inv1.number,
        vendor_name: inv1.vendor_name,
        status: inv1.status,
        // Amount fields
        total_claimed_amount: inv1.total_claimed_amount,
        payment_due: inv1.payment_due,
        amount: inv1.amount,
        total_amount: inv1.total_amount,
        net_amount: inv1.net_amount,
        gross_amount: inv1.gross_amount,
        invoice_total: inv1.invoice_total,
        balance: inv1.balance,
        current_payment_due: inv1.current_payment_due,
        // G702 fields
        g702_total_completed_and_stored_to_date: inv1.g702_total_completed_and_stored_to_date,
        g702_total_earned_less_retainage: inv1.g702_total_earned_less_retainage,
        g702_current_payment_due: inv1.g702_current_payment_due,
        // Cumulative fields
        total_completed_and_stored_to_date: inv1.total_completed_and_stored_to_date,
        work_completed_this_period: inv1.work_completed_this_period,
        work_completed_from_previous_application: inv1.work_completed_from_previous_application,
        materials_presently_stored: inv1.materials_presently_stored,
        total_materials_presently_stored: inv1.total_materials_presently_stored,
        total_retainage: inv1.total_retainage,
        // Additional
        final_amount: inv1.final_amount,
        requested_amount: inv1.requested_amount,
        approved_amount: inv1.approved_amount,
      }, null, 2));

      // Log a second invoice if available
      if (procoreData.subInvoices.length > 1) {
        const inv2 = procoreData.subInvoices[1];
        console.log('INVOICE #2 - COMPARISON:', JSON.stringify({
          number: inv2.number,
          vendor_name: inv2.vendor_name,
          total_claimed_amount: inv2.total_claimed_amount,
          payment_due: inv2.payment_due,
          g702_current_payment_due: inv2.g702_current_payment_due,
          total_completed_and_stored_to_date: inv2.total_completed_and_stored_to_date,
        }, null, 2));
      }
    }
    console.log('========== END DEBUG ==========');

    // Extract total contract value from prime contracts
    const primeContracts = procoreData.primeContract || [];
    const totalContractValue = primeContracts.reduce(
      (sum: number, pc: any) => sum + parseFloat(pc.grand_total || pc.revised_contract_amount || pc.original_contract_amount || 0),
      0
    );
    console.log(`Total contract value from ${primeContracts.length} prime contract(s): $${totalContractValue.toFixed(2)}`);

    // STEP 1: Normalize Procore data first (before fetching QB data)
    const commitments = normalizeCommitments(procoreData);
    const procoreInvoices = normalizeProcoreInvoices(procoreData);
    // Compute per-invoice retainage released first (from cumulative if needed),
    // because computePerInvoiceRetainage() uses retainageReleased in its formula.
    computePerInvoiceRetainageReleased(procoreInvoices);
    computePerInvoiceRetainage(procoreInvoices);
    const paymentApps = normalizePaymentApps(procoreData);
    const directCosts = normalizeDirectCosts(procoreData);

    // Backfill commitment billedToDate from sub invoices when the Procore
    // subcontract object doesn't carry invoiced_amount / bill_amount fields.
    // Sub invoices have a commitmentId that links back to the commitment.
    let backfillCount = 0;
    for (const commitment of commitments) {
      const matchingInvoices = procoreInvoices.filter(
        inv => inv.commitmentId === commitment.id
      );
      if (matchingInvoices.length > 0) {
        // Use amount + per-period retainage to get the gross billed total.
        // inv.amount is net-of-retainage (current_payment_due), but for the "fully billed"
        // check we need the gross amount since retainage is a payment timing issue, not a billing gap.
        const invoicedTotal = matchingInvoices.reduce((sum, inv) => sum + inv.amount + (inv.retainageThisPeriod || 0), 0);
        // Only overwrite if the commitment had no billed amount from the API
        if (commitment.billedToDate === 0 && invoicedTotal > 0) {
          commitment.billedToDate = invoicedTotal;
          backfillCount++;
          console.log(`Backfilled billedToDate for ${commitment.vendor}: $${invoicedTotal.toFixed(2)} from ${matchingInvoices.length} invoice(s)`);
        }
      } else {
        console.log(`No matching invoices found for commitment ${commitment.vendor} (id: ${commitment.id})`);
      }
    }
    if (backfillCount > 0) {
      console.log(`Backfilled billedToDate for ${backfillCount}/${commitments.length} commitments from sub invoices`);
    }

    // Backfill retentionHeld from invoice retainage when the Procore
    // subcontract list endpoint doesn't include retention_amount.
    // total_retainage on a requisition is cumulative, so take the max
    // across all invoices for each commitment (= latest running total).
    let retentionBackfillCount = 0;
    for (const commitment of commitments) {
      if (commitment.retentionHeld > 0) continue; // already populated from API
      const matchingInvoices = procoreInvoices.filter(
        inv => inv.commitmentId === commitment.id
      );
      if (matchingInvoices.length > 0) {
        const maxRetainage = Math.max(...matchingInvoices.map(inv => inv.retainage || 0));
        if (maxRetainage > 0) {
          commitment.retentionHeld = maxRetainage;
          retentionBackfillCount++;
          console.log(`Backfilled retentionHeld for ${commitment.vendor}: $${maxRetainage.toFixed(2)} from ${matchingInvoices.length} invoice(s)`);
        }
      }
    }
    if (retentionBackfillCount > 0) {
      console.log(`Backfilled retentionHeld for ${retentionBackfillCount}/${commitments.length} commitments from invoice retainage`);
    }

    console.log(`Procore data: ${commitments.length} commitments, ${procoreInvoices.length} invoices, ${paymentApps.length} pay apps, ${directCosts.length} direct costs`);

    // Debug: Log direct cost descriptions to understand labor detection
    if (directCosts.length > 0) {
      console.log('Sample direct cost descriptions (first 10):');
      directCosts.slice(0, 10).forEach((dc, i) => {
        const isLabor = dc.description.toLowerCase().match(/payroll|labor|wages|salary|worker|employee/);
        console.log(`  ${i + 1}. "${dc.description}" - ${dc.vendor} - $${dc.amount} ${isLabor ? '[LABOR]' : ''}`);
      });
    }

    // STEP 2: Collect all unique Procore vendor names
    const allProcoreVendors: string[] = [
      ...commitments.map(c => c.vendor),
      ...procoreInvoices.map(inv => inv.vendor),
      ...directCosts.map(dc => dc.vendor).filter(Boolean) as string[],
    ];
    // Deduplicate by suffix-stripped name so "ABC LLC" and "ABC Inc." don't create separate entries
    const vendorByStripped = new Map<string, string>();
    for (const v of allProcoreVendors) {
      if (!v || v === 'Unknown' || v === 'Unknown Vendor') continue;
      const stripped = stripCompanySuffixes(v).toLowerCase().trim();
      if (stripped && !vendorByStripped.has(stripped)) {
        vendorByStripped.set(stripped, v);
      }
    }
    const uniqueProcoreVendors = [...vendorByStripped.values()];
    console.log(`Found ${uniqueProcoreVendors.length} unique Procore vendors (after suffix dedup)`);

    // STEP 3: Fetch only QB vendors (lightweight query)
    console.log('Fetching QuickBooks vendors...');
    const { vendors: qbVendors, tokens: qbTokens } = await fetchQBVendors(userId);

    // STEP 4: Use AI to match vendors
    console.log('Starting AI vendor matching...');
    const aiVendorMap = await matchVendorsWithAI(uniqueProcoreVendors, qbVendors);
    console.log(`AI vendor matching complete: ${aiVendorMap.size} matches found`);

    // STEP 5: Build set of QB vendor IDs that are relevant to this project
    // Also build invoice refs for matching bills without CustomerRef
    const projectVendorIds = new Set<string>();
    const procoreInvoiceRefs: ProcoreInvoiceRef[] = [];

    // Add vendors from commitments (using AI-enhanced matching)
    for (const c of commitments) {
      const match = findVendorMatch(c.vendor, qbVendors, aiVendorMap);
      if (match) projectVendorIds.add(match.id);
    }

    // Add vendors from invoices and build invoice refs
    console.log(`========== INVOICE REF BUILD DEBUG ==========`);
    for (const inv of procoreInvoices) {
      const match = findVendorMatch(inv.vendor, qbVendors, aiVendorMap);
      if (match) {
        projectVendorIds.add(match.id);
        procoreInvoiceRefs.push({
          amount: inv.amount,
          vendor: inv.vendor,
          qbVendorId: match.id,
        });
        console.log(`Invoice ref: "${inv.vendor}" → QB vendor "${match.name}" (ID: ${match.id}) | $${inv.amount}`);
      } else {
        console.log(`NO MATCH for invoice: "${inv.vendor}" | $${inv.amount}`);
      }
    }
    console.log(`========== END INVOICE REF DEBUG ==========`);

    // Add vendors from direct costs
    for (const dc of directCosts) {
      if (dc.vendor) {
        const match = findVendorMatch(dc.vendor, qbVendors, aiVendorMap);
        if (match) projectVendorIds.add(match.id);
      }
    }

    console.log(`Found ${projectVendorIds.size} QB vendors relevant to this project`);
    console.log(`Built ${procoreInvoiceRefs.length} Procore invoice refs for bill matching`);

    // STEP 5b: Build vendor equivalence map - groups QB vendor IDs that represent the same
    // company (e.g., "JB Smith LLC" and "JB Smith Inc" should share bills)
    const strippedToVendorIds = new Map<string, Set<string>>();
    for (const v of qbVendors) {
      const stripped = normalizeString(stripCompanySuffixes(v.DisplayName));
      if (!stripped) continue;
      if (!strippedToVendorIds.has(stripped)) strippedToVendorIds.set(stripped, new Set());
      strippedToVendorIds.get(stripped)!.add(v.Id);
    }
    const vendorEquivalenceMap = new Map<string, Set<string>>();
    for (const ids of strippedToVendorIds.values()) {
      if (ids.size > 1) {
        for (const id of ids) vendorEquivalenceMap.set(id, ids);
      }
    }
    if (vendorEquivalenceMap.size > 0) {
      console.log(`Found ${vendorEquivalenceMap.size / 2} vendor equivalence groups (LLC/Inc/Corp variants)`);
    }

    // Expand projectVendorIds to include equivalent vendor IDs
    const expandedProjectVendorIds = new Set(projectVendorIds);
    for (const vendorId of projectVendorIds) {
      const equivalents = vendorEquivalenceMap.get(vendorId);
      if (equivalents) {
        for (const eqId of equivalents) expandedProjectVendorIds.add(eqId);
      }
    }
    if (expandedProjectVendorIds.size > projectVendorIds.size) {
      console.log(`Expanded project vendors from ${projectVendorIds.size} to ${expandedProjectVendorIds.size} (including LLC/Inc equivalents)`);
    }

    // STEP 6: Find the project customer first (needed for filtering bills)
    // Now also returns ancestor (parent) customer IDs for sub-customer hierarchy matching
    const projectCustomer = await findProjectCustomer(qbTokens, userId, projectName);
    const projectCustomerId = projectCustomer?.customerId || null;
    const projectCustomerName = projectCustomer?.customerName || null;
    const ancestorCustomerIds = projectCustomer?.ancestorCustomerIds || [];

    // STEP 7: Fetch ALL QB bills and filter by project CustomerRef
    // Bills without CustomerRef only included if exact amount+vendor match to Procore invoice
    // Bills tagged to ancestor/parent customer included only if vendor is a known project vendor
    const qbBillsRaw = await fetchAllBillsForProject(qbTokens, userId, projectCustomerId, procoreInvoiceRefs, expandedProjectVendorIds, ancestorCustomerIds);
    console.log(`Found ${qbBillsRaw.length} QB bills for project "${projectCustomerName || projectName}"`);

    // STEP 8: Fetch AR data (invoices and payments) - only if we have payment apps
    // Filter by customer matching the project name (get all invoices to catch discrepancies)
    let qbInvoicesRaw: any[] = [];
    let qbPaymentsRaw: any[] = [];
    let matchedQBCustomer: string | null = projectCustomerName;
    if (paymentApps.length > 0) {
      const arData = await fetchQBInvoicesAndPayments(qbTokens, userId, projectName, projectCustomerId);
      qbInvoicesRaw = arData.invoices;
      qbPaymentsRaw = arData.paymentsReceived;
      matchedQBCustomer = arData.matchedCustomer;
    }

    // Normalize QB data
    const qbBills = normalizeQBBills({ bills: qbBillsRaw });
    const qbBillPayments: QBBillPayment[] = []; // Bill payment details populated from bill balance data
    const qbInvoices = normalizeQBInvoices({ invoices: qbInvoicesRaw });
    const qbPayments = normalizeQBPayments({ paymentsReceived: qbPaymentsRaw });

    // STEP 9: Fetch QB labor expenses (accounts 5010-5012)
    const { expenses: qbLaborExpenses, stats: laborStats } = await fetchQBLaborExpenses(qbTokens, userId, projectCustomerId, ancestorCustomerIds);

    console.log(`QB data for project: ${qbBills.length} bills, ${qbInvoices.length} invoices, ${qbLaborExpenses.length} labor expenses`);
    if (laborStats.withoutCustomerRef > 0) {
      console.log(`Note: ${laborStats.withoutCustomerRef} untagged labor expenses exist in QB (not assigned to any project)`);
    }

    // Run all matching
    const allResults: MatchResult[] = [];

    // 1. Match sub invoices to QB bills
    const { results: invoiceResults, matchedQBBillIds, matchedProcoreIds } = matchInvoicesToBills(
      procoreInvoices,
      qbBills,
      qbVendors,
      aiVendorMap,
      vendorEquivalenceMap
    );
    allResults.push(...invoiceResults);

    console.log(`========== MATCHING DEBUG ==========`);
    console.log(`QB Bills available for matching: ${qbBills.length}`);
    console.log(`Procore invoices to match: ${procoreInvoices.length}`);
    console.log(`QB Bills matched to Procore invoices: ${matchedQBBillIds.size}`);
    console.log(`Procore invoices matched: ${matchedProcoreIds.size}`);
    console.log(`QB Bills remaining unmatched: ${qbBills.length - matchedQBBillIds.size}`);
    const unmatchedProcoreInvoices = invoiceResults.filter(r => r.status === 'timing' || r.status === 'unmatched_procore');
    if (unmatchedProcoreInvoices.length > 0) {
      console.log(`Procore invoices with no QB match (${unmatchedProcoreInvoices.length}):`);
      for (const u of unmatchedProcoreInvoices) {
        console.log(`  - ${u.vendor}: ${u.procoreRef} ($${u.procoreValue?.toFixed(2)}) — ${u.status}: ${u.notes}`);
      }
    }

    // 2. Separate labor costs from direct costs and match each
    const { laborResults, nonLaborDirectCosts } = matchLaborCosts(directCosts, qbLaborExpenses);
    allResults.push(...laborResults);

    // 3. Match non-labor direct costs to remaining QB bills
    const directCostResults = matchDirectCostsToBills(
      nonLaborDirectCosts,
      qbBills,
      matchedQBBillIds,
      qbVendors,
      aiVendorMap,
      vendorEquivalenceMap
    );
    allResults.push(...directCostResults);
    console.log(`After direct cost matching, total matched QB bills: ${matchedQBBillIds.size}`);

    // 4. Find unmatched QB bills - only from vendors with Procore presence on this project
    const unmatchedBillResults = findUnmatchedQBBills(
      qbBills, matchedQBBillIds, commitments, qbVendors, aiVendorMap, expandedProjectVendorIds
    );
    allResults.push(...unmatchedBillResults);
    console.log(`Unmatched QB bills added to results: ${unmatchedBillResults.length}`);
    console.log(`========== END MATCHING DEBUG ==========`);

    // 5. Match payment applications to QB invoices (AR)
    const paymentAppResults = matchPaymentAppsToInvoices(paymentApps, qbInvoices, projectName);
    allResults.push(...paymentAppResults);

    // 6. Vendor-level totals
    const vendorTotalResults = reconcileVendorTotals(commitments, qbBills, qbVendors, aiVendorMap, vendorEquivalenceMap);
    allResults.push(...vendorTotalResults);

    // Log results breakdown by type
    const invoiceCount = allResults.filter(r => r.matchType === 'invoice').length;
    const paymentAppCount = allResults.filter(r => r.matchType === 'payment_app').length;
    const directCostCount = allResults.filter(r => r.matchType === 'direct_cost').length;
    const laborCount = allResults.filter(r => r.matchType === 'labor').length;
    const vendorTotalCount = allResults.filter(r => r.matchType === 'vendor_total').length;
    console.log(`Results breakdown: ${invoiceCount} invoices, ${paymentAppCount} payment apps, ${directCostCount} direct costs, ${laborCount} labor, ${vendorTotalCount} vendor totals`);
    console.log(`Total results: ${allResults.length}`);

    // Generate closeout items
    const closeoutItems = generateCloseoutItems(commitments, allResults);
    console.log(`Generated ${closeoutItems.length} closeout items`);

    // Calculate summary stats
    const totalCommitted = commitments.reduce((sum, c) => sum + c.currentValue, 0);
    const totalBilled = commitments.reduce((sum, c) => sum + c.billedToDate, 0);
    const totalPaid = commitments.reduce((sum, c) => sum + c.paidToDate, 0);
    const totalRetention = commitments.reduce((sum, c) => sum + c.retentionHeld, 0);

    // NEW: Calculate Procore vs QBO subcontractor totals
    const subInvoiceResults = allResults.filter(r => r.matchType === 'invoice');
    const procoreSubInvoiced = subInvoiceResults
      .reduce((sum, r) => sum + (r.procoreValue || 0), 0);
    const qboSubInvoiced = subInvoiceResults
      .reduce((sum, r) => sum + (r.qbValue || 0), 0);

    // Procore paid comes from commitments
    const procoreSubPaid = totalPaid;

    // QBO paid = total bill amount - remaining balance for commitment vendors
    // Get list of ALL commitment vendor IDs (subcontracts + purchase orders) to match procoreSubPaid
    const commitmentVendorIds = new Set<string>();
    for (const c of commitments) {
      const match = findVendorMatch(c.vendor, qbVendors, aiVendorMap);
      if (match) {
        commitmentVendorIds.add(match.id);
        console.log(`Matched commitment vendor (${c.type}): ${c.vendor} -> QB ID ${match.id} (${match.name})`);
      } else {
        console.log(`No QB match for commitment vendor: ${c.vendor} (${c.type})`);
      }
    }
    console.log(`Found ${commitmentVendorIds.size} matched commitment vendor IDs for QBO paid calculation`);
    // Sum paid amounts for commitment vendor bills
    const commitmentBills = qbBills.filter(b => commitmentVendorIds.has(b.vendorId));
    console.log(`Found ${commitmentBills.length} bills for commitment vendors (out of ${qbBills.length} total)`);

    // Log details for debugging
    let qboSubPaid = 0;
    for (const b of commitmentBills) {
      const paid = b.amount - b.balance;
      qboSubPaid += paid;
      console.log(`  Bill ${b.docNumber}: ${b.vendor}, amount=${b.amount}, balance=${b.balance}, paid=${paid}`);
    }
    console.log(`QBO Sub Paid Total: ${qboSubPaid}`);

    // Calculate open AP/AR/pending invoice counts for soft close tracking
    const openApBills = commitmentBills.filter(b => b.balance > 0);
    const openApCount = openApBills.length;
    const openApAmount = openApBills.reduce((sum, b) => sum + b.balance, 0);
    console.log(`Open APs: ${openApCount} bills with outstanding balance totaling $${openApAmount.toFixed(2)}`);

    const openArInvoices = qbInvoices.filter(inv => inv.balance > 0);
    const openArCount = openArInvoices.length;
    const openArAmount = openArInvoices.reduce((sum, inv) => sum + inv.balance, 0);
    console.log(`Open ARs: ${openArCount} invoices with outstanding balance totaling $${openArAmount.toFixed(2)}`);

    // Pending invoices: commitments where retainage is still held or not fully billed
    const pendingInvoiceCommitments = commitments.filter(c =>
      c.retentionHeld > 0 || c.currentValue > c.billedToDate + 0.01
    );
    const pendingInvoiceCount = pendingInvoiceCommitments.length;
    console.log(`Pending invoices: ${pendingInvoiceCount} commitments with retainage or unbilled amounts`);

    // Retention breakdown
    const procoreRetentionHeld = totalRetention;
    // QBO retention: sum qbRetainage from matched invoice results (retainage baked into QB bill totals)
    const qboRetentionHeld = allResults
      .filter(r => r.matchType === 'invoice' && r.qbRetainage && r.qbRetainage > 0)
      .reduce((sum, r) => sum + (r.qbRetainage || 0), 0);

    // Retainage Released = amount of retainage that has been billed/invoiced back
    const procoreRetainageReleased = procoreInvoices.reduce(
      (sum, inv) => sum + (inv.retainageReleased || 0), 0
    );
    // QBO retainage released: use same per-invoice released amounts from matched results
    // since retainage release is a contractual event reflected in both systems.
    const qboRetainageReleased = allResults
      .filter(r => r.matchType === 'invoice' && r.retainageReleased && r.retainageReleased > 0)
      .reduce((sum, r) => sum + (r.retainageReleased || 0), 0);

    // Retainage Paid = amount of billed retainage that has been paid out.
    // Uses "retainage paid last" heuristic: in construction, work amounts are
    // paid first and retainage is held until last. So retainage is only considered
    // paid once the bill payment exceeds the non-retainage portion.
    let procoreRetainagePaid = 0;
    let qboRetainagePaid = 0;
    for (const result of allResults) {
      if (result.matchType === 'invoice' && result.retainageReleased && result.retainageReleased > 0 && result.qbRef) {
        const billRef = (result.qbRef || '').replace(/^Bill\s*#?\s*/, '');
        const matchingBill = qbBills.find(b => (b.docNumber || b.id) === billRef);
        if (matchingBill && matchingBill.amount > 0) {
          if (matchingBill.balance === 0) {
            // Bill fully paid — retainage released amount was paid in full
            procoreRetainagePaid += result.retainageReleased;
            qboRetainagePaid += result.retainageReleased;
          } else {
            // Bill partially paid — assume retainage is paid last
            const totalPaid = matchingBill.amount - matchingBill.balance;
            const nonRetainagePortion = matchingBill.amount - result.retainageReleased;
            const retPaid = Math.max(0, totalPaid - nonRetainagePortion);
            procoreRetainagePaid += retPaid;
            qboRetainagePaid += retPaid;
          }
        }
      }
    }

    // Legacy field names: procore_retention_paid / qbo_retention_paid map to released
    // (kept for backward compatibility with DB schema)
    const procoreRetentionPaid = procoreRetainageReleased;
    const qboRetentionPaid = qboRetainageReleased;

    // Labor totals - from Procore payroll direct costs and QB labor accounts (5010-5012)
    const procoreLabor = directCosts
      .filter(dc => isLaborDirectCost(dc))
      .reduce((sum, dc) => sum + dc.amount, 0);
    const qboLabor = qbLaborExpenses.reduce((sum, e) => sum + e.amount, 0);

    const matchedCount = allResults.filter(r => r.status === 'matched').length;
    const partialCount = allResults.filter(r => r.status === 'partial').length;
    // Exclude vendor_total from severity counts — they are aggregate summaries that
    // duplicate individual invoice results and create misleading critical/warning counts
    const nonAggregateResults = allResults.filter(r => r.matchType !== 'vendor_total');
    const warningCount = nonAggregateResults.filter(r => r.severity === 'warning').length;
    const criticalCount = nonAggregateResults.filter(r => r.severity === 'critical').length;
    const totalExposure = closeoutItems.reduce((sum, i) => sum + i.amountAtRisk, 0);

    // Calculate Soft/Hard Close Eligibility (Phase 8+9)
    // Filter all result types from allResults for complete eligibility checks
    const allSubInvoices = allResults.filter(r => r.matchType === 'invoice');
    const allOwnerInvoices = allResults.filter(r => r.matchType === 'payment_app');
    const allDirectCosts = allResults.filter(r => r.matchType === 'direct_cost');
    const allLaborResults = allResults.filter(r => r.matchType === 'labor');

    // Soft Close: All items reconciled (severity = 'info') and labor matches
    const subInvoicesReconciled = allSubInvoices.every(r => r.severity === 'info');
    const ownerInvoicesReconciled = allOwnerInvoices.every(r => r.severity === 'info');
    const directCostsReconciled = allDirectCosts.every(r => r.severity === 'info');
    const laborReconciled = Math.abs(procoreLabor - qboLabor) < 100; // Allow $100 tolerance

    const canSoftClose = (
      allSubInvoices.length === 0 || subInvoicesReconciled
    ) && (
      allOwnerInvoices.length === 0 || ownerInvoicesReconciled
    ) && (
      allDirectCosts.length === 0 || directCostsReconciled
    ) && laborReconciled;

    // Hard Close: Soft close + all payments complete
    // Check if subcontractors are fully billed and paid
    for (const c of commitments) {
      console.log(`  Hard close check: ${c.vendor} — billedToDate=$${c.billedToDate.toFixed(2)}, currentValue=$${c.currentValue.toFixed(2)}, diff=$${Math.abs(c.billedToDate - c.currentValue).toFixed(2)}`);
    }
    const subcontractorsFullyBilled = commitments.every(c =>
      Math.abs(c.billedToDate - c.currentValue) < 1 // Within $1 of full billing
    );
    const subcontractorsPaid = Math.abs(procoreSubPaid - procoreSubInvoiced) < 100; // Within $100

    // Check if owner is fully billed (pay apps cover contract value)
    // This would require contract value - using total committed as proxy
    const ownerFullyBilled = paymentApps.length > 0;

    const canHardClose = canSoftClose && subcontractorsFullyBilled && subcontractorsPaid;

    console.log(`Close eligibility: soft=${canSoftClose}, hard=${canHardClose}`);
    console.log(`  Sub invoices reconciled: ${subInvoicesReconciled} (${allSubInvoices.length} items)`);
    console.log(`  Owner invoices reconciled: ${ownerInvoicesReconciled} (${allOwnerInvoices.length} items)`);
    console.log(`  Direct costs reconciled: ${directCostsReconciled} (${allDirectCosts.length} items)`);
    console.log(`  Labor reconciled: ${laborReconciled} (Procore: $${procoreLabor}, QBO: $${qboLabor})`);
    console.log(`  Subs fully billed: ${subcontractorsFullyBilled}, Subs paid: ${subcontractorsPaid}`);

    const summaryData = { totalCommitted, totalBilled, totalPaid, totalRetention };

    // Get AI summary — exclude vendor_total aggregate results so the AI doesn't
    // report false variances from summary-level comparisons
    const resultsForAI = allResults.filter(r => r.matchType !== 'vendor_total');
    const aiSummary = await getAIAnalysis(resultsForAI, summaryData);

    // Build report
    const report = {
      id: null as string | null,
      project_id: projectId,
      project_name: projectName,
      generated_at: new Date().toISOString(),
      total_contract_value: totalContractValue,
      total_committed: totalCommitted,
      total_billed_by_subs: totalBilled,
      total_paid_to_subs: totalPaid,
      sub_retention_held: totalRetention,
      // NEW: Procore vs QBO comparison totals
      procore_sub_invoiced: procoreSubInvoiced,
      qbo_sub_invoiced: qboSubInvoiced,
      procore_sub_paid: procoreSubPaid,
      qbo_sub_paid: qboSubPaid,
      procore_retention_held: procoreRetentionHeld,
      qbo_retention_held: qboRetentionHeld,
      procore_retention_paid: procoreRetentionPaid,
      qbo_retention_paid: qboRetentionPaid,
      // Retainage released vs paid (separated)
      procore_retainage_released: procoreRetainageReleased,
      qbo_retainage_released: qboRetainageReleased,
      procore_retainage_paid: procoreRetainagePaid,
      qbo_retainage_paid: qboRetainagePaid,
      procore_labor: procoreLabor,
      qbo_labor: qboLabor,
      // Labor stats for UI warnings
      labor_stats: {
        total_qb_labor_items: laborStats.totalLaborLineItems,
        tagged_to_projects: laborStats.withCustomerRef,
        untagged: laborStats.withoutCustomerRef,
        matching_this_project: laborStats.matchingProject,
      },
      total_items: allResults.length,
      matched_items: matchedCount,
      partial_matches: partialCount,
      reconciled_items: matchedCount + partialCount,
      warning_items: warningCount,
      critical_items: criticalCount,
      open_closeout_items: closeoutItems.length,
      estimated_exposure: totalExposure,
      // Soft/Hard Close eligibility (Phase 8+9)
      soft_close_eligible: canSoftClose,
      hard_close_eligible: canHardClose,
      executive_summary: aiSummary,
      // Financial tail tracking for soft close
      ai_analysis: {
        open_ap_count: openApCount,
        open_ap_amount: openApAmount,
        open_ap_items: openApBills.map(b => {
          const paid = b.amount - b.balance;
          // Find matching Procore commitment for this vendor
          const commitment = commitments.find(c => {
            const match = findVendorMatch(c.vendor, qbVendors, aiVendorMap);
            return match && match.id === b.vendorId;
          });
          return {
            vendor: b.vendor,
            bill_ref: b.docNumber || b.id,
            amount: b.amount,
            balance: b.balance,
            paid,
            date: b.date || null,
            due_date: b.dueDate || null,
            memo: b.memo || null,
            // Commitment-level context
            contract_value: commitment?.currentValue ?? null,
            billed_to_date: commitment?.billedToDate ?? null,
            paid_to_date: commitment?.paidToDate ?? null,
            retention_held: commitment?.retentionHeld ?? null,
            commitment_type: commitment?.type ?? null,
            commitment_status: commitment?.status ?? null,
            commitment_title: commitment?.title ?? null,
          };
        }),
        // All bill details (including fully paid) for invoice detail modal enrichment
        all_bill_details: commitmentBills.map(b => {
          const paid = b.amount - b.balance;
          const commitment = commitments.find(c => {
            const match = findVendorMatch(c.vendor, qbVendors, aiVendorMap);
            return match && match.id === b.vendorId;
          });
          return {
            vendor: b.vendor,
            bill_ref: b.docNumber || b.id,
            amount: b.amount,
            balance: b.balance,
            paid,
            date: b.date || null,
            due_date: b.dueDate || null,
            memo: b.memo || null,
            contract_value: commitment?.currentValue ?? null,
            billed_to_date: commitment?.billedToDate ?? null,
            paid_to_date: commitment?.paidToDate ?? null,
            retention_held: commitment?.retentionHeld ?? null,
            commitment_type: commitment?.type ?? null,
            commitment_status: commitment?.status ?? null,
            commitment_title: commitment?.title ?? null,
          };
        }),
        open_ar_count: openArCount,
        open_ar_amount: openArAmount,
        open_ar_items: openArInvoices.map(inv => ({
          description: `Invoice #${inv.DocNumber || inv.Id}`,
          amount: inv.TotalAmt || 0,
          balance: inv.Balance || 0,
        })),
        pending_invoice_count: pendingInvoiceCount,
        pending_invoice_items: pendingInvoiceCommitments.map(c => ({
          vendor: c.vendor,
          current_value: c.currentValue,
          billed_to_date: c.billedToDate,
          retention_held: c.retentionHeld,
        })),
        // Sub payment summaries per vendor for the Sub Payments tab
        sub_payment_summaries: commitments.map(c => {
          // Get all matched invoice results for this commitment
          const vendorResults = allResults.filter(r =>
            r.matchType === 'invoice' && r.vendor &&
            r.vendor.toLowerCase() === c.vendor.toLowerCase()
          );
          const procoreWorkBilled = vendorResults.reduce((sum, r) => sum + (r.procoreValue || 0), 0);
          const qboWorkBilled = vendorResults.reduce((sum, r) => sum + (r.qbValue || 0), 0);
          const procoreRetHeld = vendorResults.reduce((sum, r) => sum + (r.procoreRetainage || 0), 0);
          const qboRetHeld = vendorResults.reduce((sum, r) => sum + (r.qbRetainage || 0), 0);
          const procoreRetReleased = vendorResults.reduce((sum, r) => sum + (r.retainageReleased || 0), 0);
          // Find matching QB bills for payment status
          const vendorMatch = findVendorMatch(c.vendor, qbVendors, aiVendorMap);
          const vendorBills = vendorMatch
            ? qbBills.filter(b => b.vendorId === vendorMatch.id)
            : [];
          const qboTotalPaid = vendorBills.reduce((sum, b) => sum + (b.amount - b.balance), 0);
          // Retainage paid: "retainage paid last" heuristic — retainage is only
          // considered paid once bill payment exceeds the non-retainage portion
          let retainagePaid = 0;
          for (const r of vendorResults) {
            if (r.retainageReleased && r.retainageReleased > 0 && r.qbRef) {
              const billRef = (r.qbRef || '').replace(/^Bill\s*#?\s*/, '');
              const bill = qbBills.find(b => (b.docNumber || b.id) === billRef);
              if (bill && bill.amount > 0) {
                if (bill.balance === 0) {
                  retainagePaid += r.retainageReleased;
                } else {
                  const totalPaid = bill.amount - bill.balance;
                  const nonRetainagePortion = bill.amount - r.retainageReleased;
                  retainagePaid += Math.max(0, totalPaid - nonRetainagePortion);
                }
              }
            }
          }
          return {
            vendor: c.vendor,
            commitment_type: c.type,
            committed_cost: c.currentValue,
            procore_work_billed: procoreWorkBilled,
            procore_work_paid: c.paidToDate,
            procore_retainage_held: procoreRetHeld,
            procore_retainage_released: procoreRetReleased,
            procore_retainage_paid: retainagePaid,
            qbo_work_billed: qboWorkBilled,
            qbo_work_paid: qboTotalPaid,
            qbo_retainage_held: qboRetHeld,
            qbo_retainage_released: procoreRetReleased, // Same contractual event
            qbo_retainage_paid: retainagePaid,
            payment_variance: c.paidToDate - qboTotalPaid,
            invoice_count: vendorResults.length,
            billed_pct: c.currentValue > 0 ? (procoreWorkBilled / c.currentValue * 100) : 0,
          };
        }),
        // Owner payment summary for the Owner Payments tab
        owner_payment_summary: {
          procore_work_billed: paymentApps.reduce((sum, a) => sum + a.approvedAmount, 0),
          procore_work_paid: paymentApps.reduce((sum, a) => sum + (a.netAmount || a.approvedAmount), 0),
          procore_retainage_held: paymentApps.length > 0 ? paymentApps[paymentApps.length - 1].retainage : 0,
          qbo_work_billed: qbInvoices.reduce((sum, inv) => sum + inv.amount, 0),
          qbo_work_paid: qbPayments.reduce((sum, p) => sum + p.amount, 0),
          procore_payment_apps: paymentApps.map(a => ({
            number: a.number,
            status: a.status,
            billing_date: a.billingDate,
            total_amount: a.totalAmount,
            approved_amount: a.approvedAmount,
            retainage: a.retainage,
            net_amount: a.netAmount,
          })),
          owner_invoices: qbInvoices.map(inv => ({
            id: inv.id,
            doc_number: inv.docNumber,
            amount: inv.amount,
            balance: inv.balance,
            date: inv.date,
            customer: inv.customer,
          })),
          owner_payments: qbPayments.map(p => ({
            id: p.id,
            amount: p.amount,
            date: p.date,
            customer: p.customer,
            invoice_ids: p.invoiceIds,
          })),
        },
      },
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
        console.log('Procore vs QBO totals:', {
          procore_sub_invoiced: report.procore_sub_invoiced,
          qbo_sub_invoiced: report.qbo_sub_invoiced,
          procore_sub_paid: report.procore_sub_paid,
          qbo_sub_paid: report.qbo_sub_paid,
          procore_labor: report.procore_labor,
          qbo_labor: report.qbo_labor,
        });
        const { data: reportData, error: reportError } = await supabase
          .from('reconciliation_reports')
          .insert({
            project_id: projectId,
            generated_at: report.generated_at,
            total_contract_value: report.total_contract_value,
            total_committed: report.total_committed,
            total_billed_by_subs: report.total_billed_by_subs,
            total_paid_to_subs: report.total_paid_to_subs,
            sub_retention_held: report.sub_retention_held,
            // Procore vs QBO comparison totals
            procore_sub_invoiced: report.procore_sub_invoiced,
            qbo_sub_invoiced: report.qbo_sub_invoiced,
            procore_sub_paid: report.procore_sub_paid,
            qbo_sub_paid: report.qbo_sub_paid,
            procore_retention_held: report.procore_retention_held,
            qbo_retention_held: report.qbo_retention_held,
            procore_retention_paid: report.procore_retention_paid,
            qbo_retention_paid: report.qbo_retention_paid,
            // Retainage released vs paid (separated)
            procore_retainage_released: report.procore_retainage_released,
            qbo_retainage_released: report.qbo_retainage_released,
            procore_retainage_paid: report.procore_retainage_paid,
            qbo_retainage_paid: report.qbo_retainage_paid,
            procore_labor: report.procore_labor,
            qbo_labor: report.qbo_labor,
            // Counts
            reconciled_items: report.reconciled_items,
            warning_items: report.warning_items,
            critical_items: report.critical_items,
            open_closeout_items: report.open_closeout_items,
            estimated_exposure: report.estimated_exposure,
            // Close eligibility
            soft_close_eligible: report.soft_close_eligible,
            hard_close_eligible: report.hard_close_eligible,
            executive_summary: report.executive_summary,
            ai_analysis: report.ai_analysis,
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
            // Build base result rows (columns that exist in the initial schema)
            const baseResultRows = allResults.map(r => ({
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
            }));

            // Try inserting with retainage columns (from migration 005);
            // fall back to base columns if the migration hasn't been applied
            let resultsError: any = null;
            const retainageRows = allResults.map((r, i) => ({
              ...baseResultRows[i],
              procore_retainage: r.procoreRetainage || 0,
              qb_retainage: r.qbRetainage || 0,
              retainage_released: r.retainageReleased || 0,
              work_completed_this_period: r.workCompletedThisPeriod || 0,
              work_completed_previous: r.workCompletedPrevious || 0,
              materials_stored: r.materialsStored || 0,
              total_completed_and_stored: r.totalCompletedAndStored || 0,
              billing_date: r.billingDate || null,
              payment_app_retainage: r.paymentAppRetainage || 0,
              procore_date: r.procoreDate || null,
              qb_date: r.qbDate || null,
            }));
            const { error: firstErr } = await supabase.from('reconciliation_results').insert(retainageRows);
            if (firstErr && firstErr.code === 'PGRST204') {
              console.log(`Column not found (${firstErr.message}), inserting with base columns only...`);
              const { error: secondErr } = await supabase.from('reconciliation_results').insert(baseResultRows);
              resultsError = secondErr;
            } else {
              resultsError = firstErr;
            }
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
                status: c.status,
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
