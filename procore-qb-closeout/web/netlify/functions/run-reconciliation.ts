import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// Use env vars with hardcoded fallback for Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://eruvdljuqvvoxfnlraje.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVydXZkbGp1cXZ2b3hmbmxyYWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNTc5ODksImV4cCI6MjA4NTgzMzk4OX0.JeR6g6NJa7c9yohW19OWlS-EMKg650Jwf4WYXYQGBhU';
const supabase = createClient(supabaseUrl, supabaseKey);

// Anthropic API for AI analysis
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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

function normalizeString(str: string): string {
  return str.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
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

  // Process subcontracts
  for (const sub of procoreData.commitments?.subcontracts || []) {
    commitments.push({
      id: String(sub.id),
      vendor: sub.vendor?.name || sub.contract_company?.name || 'Unknown Vendor',
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
    commitments.push({
      id: String(po.id),
      vendor: po.vendor?.name || po.contract_company?.name || 'Unknown Vendor',
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

  for (const inv of procoreData.subInvoices || []) {
    invoices.push({
      id: String(inv.id),
      commitmentId: String(inv.contract_id || inv.commitment_id || ''),
      vendor: inv.vendor?.name || inv.origin_data?.vendor_name || 'Unknown',
      number: inv.number || inv.invoice_number || '',
      status: inv.status || '',
      amount: parseFloat(inv.amount || inv.total_amount || inv.payment_due || 0),
      billingDate: inv.billing_date || inv.invoice_date || '',
      paymentDue: parseFloat(inv.payment_due || inv.balance || 0),
    });
  }

  return invoices;
}

function normalizePaymentApps(procoreData: any): ProcorePaymentApp[] {
  const apps: ProcorePaymentApp[] = [];

  for (const app of procoreData.paymentApplications || []) {
    apps.push({
      id: String(app.id),
      number: app.number || String(app.id),
      status: app.status || '',
      billingDate: app.billing_date || '',
      totalAmount: parseFloat(app.total_claimed_amount || app.total_amount || 0),
      approvedAmount: parseFloat(app.approved_amount || app.total_amount || 0),
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

// Match Procore sub invoices to QuickBooks bills
function matchInvoicesToBills(
  procoreInvoices: ProcoreInvoice[],
  qbBills: QBBill[],
  qbVendors: any[]
): { results: MatchResult[]; matchedQBBillIds: Set<string> } {
  const results: MatchResult[] = [];
  const matchedQBBillIds = new Set<string>();
  const matchedProcoreIds = new Set<string>();

  for (const pInv of procoreInvoices) {
    const vendorMatch = findBestVendorMatch(pInv.vendor, qbVendors);

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
        if (inv.docNumber.includes(app.number) || app.number.includes(inv.docNumber)) {
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
  qbVendors: any[]
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

    const vendorMatch = findBestVendorMatch(dc.vendor, qbVendors);

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

// Find unmatched QB bills
function findUnmatchedQBBills(qbBills: QBBill[], matchedIds: Set<string>): MatchResult[] {
  const results: MatchResult[] = [];

  for (const bill of qbBills) {
    if (!matchedIds.has(bill.id)) {
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
        notes: 'QuickBooks bill with no matching Procore invoice or direct cost',
        qbDate: bill.date,
        requiresAction: bill.amount >= 500,
      });
    }
  }

  return results;
}

// Vendor-level totals reconciliation
function reconcileVendorTotals(
  commitments: ProcoreCommitment[],
  qbBills: QBBill[],
  qbVendors: any[]
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

    const vendorMatch = findBestVendorMatch(vendorName, qbVendors);

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
    const { procoreData, qbData, projectId, userId } = JSON.parse(event.body || '{}');

    if (!procoreData || !qbData) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Both Procore and QuickBooks data required' }),
      };
    }

    const projectName = procoreData.project?.name || 'Unknown Project';

    // Normalize all data
    const commitments = normalizeCommitments(procoreData);
    const procoreInvoices = normalizeProcoreInvoices(procoreData);
    const paymentApps = normalizePaymentApps(procoreData);
    const directCosts = normalizeDirectCosts(procoreData);

    const qbBills = normalizeQBBills(qbData);
    const qbBillPayments = normalizeQBBillPayments(qbData);
    const qbInvoices = normalizeQBInvoices(qbData);
    const qbPayments = normalizeQBPayments(qbData);
    const qbVendors = qbData.vendors || [];

    console.log(`Reconciling: ${commitments.length} commitments, ${procoreInvoices.length} invoices, ${paymentApps.length} pay apps, ${directCosts.length} direct costs`);
    console.log(`QB data: ${qbBills.length} bills, ${qbInvoices.length} invoices`);

    // Run all matching
    const allResults: MatchResult[] = [];

    // 1. Match sub invoices to QB bills
    const { results: invoiceResults, matchedQBBillIds } = matchInvoicesToBills(
      procoreInvoices,
      qbBills,
      qbVendors
    );
    allResults.push(...invoiceResults);

    // 2. Match direct costs to remaining QB bills
    const directCostResults = matchDirectCostsToBills(
      directCosts,
      qbBills,
      matchedQBBillIds,
      qbVendors
    );
    allResults.push(...directCostResults);

    // 3. Find unmatched QB bills
    const unmatchedBillResults = findUnmatchedQBBills(qbBills, matchedQBBillIds);
    allResults.push(...unmatchedBillResults);

    // 4. Match payment applications to QB invoices (AR)
    const paymentAppResults = matchPaymentAppsToInvoices(paymentApps, qbInvoices, projectName);
    allResults.push(...paymentAppResults);

    // 5. Vendor-level totals
    const vendorTotalResults = reconcileVendorTotals(commitments, qbBills, qbVendors);
    allResults.push(...vendorTotalResults);

    // Generate closeout items
    const closeoutItems = generateCloseoutItems(commitments, allResults);

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
        await supabase.from('projects').upsert({
          id: projectId,
          procore_id: procoreData.project?.id,
          name: projectName,
          project_number: procoreData.project?.project_number,
          updated_at: new Date().toISOString(),
        });

        // Insert report
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

        if (reportData) {
          report.id = reportData.id;

          // Insert results
          if (allResults.length > 0) {
            await supabase.from('reconciliation_results').insert(
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
