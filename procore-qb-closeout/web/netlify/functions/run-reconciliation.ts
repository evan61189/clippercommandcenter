import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// Use env vars with hardcoded fallback for Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://eruvdljuqvvoxfnlraje.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVydXZkbGp1cXZ2b3hmbmxyYWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNTc5ODksImV4cCI6MjA4NTgzMzk4OX0.JeR6g6NJa7c9yohW19OWlS-EMKg650Jwf4WYXYQGBhU';
const supabase = createClient(supabaseUrl, supabaseKey);

// Anthropic API for AI analysis
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

interface Commitment {
  vendor: string;
  procore_id: string;
  type: string;
  title: string;
  original_amount: number;
  approved_changes: number;
  current_value: number;
  billed_to_date: number;
  paid_to_date: number;
  retention_held: number;
}

interface Bill {
  vendor: string;
  qb_id: string;
  doc_number: string;
  amount: number;
  balance: number;
  date: string;
}

interface ReconciliationResult {
  id: string;
  item_type: string;
  description: string;
  vendor: string | null;
  procore_value: number | null;
  qb_value: number | null;
  variance: number;
  variance_pct: number;
  severity: 'info' | 'warning' | 'critical';
  notes: string;
  requires_action: boolean;
}

// Fuzzy match vendor names
function fuzzyMatch(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 100;
  if (s1.includes(s2) || s2.includes(s1)) return 80;

  const words1 = new Set(s1.split(/\s+/));
  const words2 = new Set(s2.split(/\s+/));
  const intersection = [...words1].filter(w => words2.has(w));
  const union = new Set([...words1, ...words2]);

  return Math.round((intersection.length / union.size) * 100);
}

// Find best vendor match
function findVendorMatch(
  procoreVendor: string,
  qbVendors: { DisplayName: string; Id: string }[]
): { name: string; id: string; score: number } | null {
  let bestMatch = null;
  let bestScore = 0;

  for (const qbVendor of qbVendors) {
    const score = fuzzyMatch(procoreVendor, qbVendor.DisplayName);
    if (score > bestScore && score >= 70) {
      bestScore = score;
      bestMatch = { name: qbVendor.DisplayName, id: qbVendor.Id, score };
    }
  }

  return bestMatch;
}

// Calculate severity
function calculateSeverity(variance: number, baseAmount: number): 'info' | 'warning' | 'critical' {
  const absVariance = Math.abs(variance);
  const pct = baseAmount ? Math.abs(variance / baseAmount) : 0;

  if (absVariance >= 1000 || pct >= 0.05) return 'critical';
  if (absVariance >= 100 || pct >= 0.01) return 'warning';
  return 'info';
}

// Generate unique ID
function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

// Process Procore data into normalized commitments
function normalizeCommitments(procoreData: any): Commitment[] {
  const commitments: Commitment[] = [];

  // Process subcontracts
  for (const sub of procoreData.commitments?.subcontracts || []) {
    const vendor = sub.vendor?.name || 'Unknown Vendor';
    const original = parseFloat(sub.grand_total || 0);
    const approvedCOs = parseFloat(sub.approved_change_orders || 0);

    commitments.push({
      vendor,
      procore_id: String(sub.id),
      type: 'subcontract',
      title: sub.title || '',
      original_amount: original,
      approved_changes: approvedCOs,
      current_value: original + approvedCOs,
      billed_to_date: parseFloat(sub.bill_amount || 0),
      paid_to_date: parseFloat(sub.paid_amount || 0),
      retention_held: parseFloat(sub.retention_amount || 0),
    });
  }

  // Process purchase orders
  for (const po of procoreData.commitments?.purchaseOrders || []) {
    const vendor = po.vendor?.name || 'Unknown Vendor';
    const original = parseFloat(po.grand_total || 0);

    commitments.push({
      vendor,
      procore_id: String(po.id),
      type: 'purchase_order',
      title: po.title || '',
      original_amount: original,
      approved_changes: 0,
      current_value: original,
      billed_to_date: parseFloat(po.bill_amount || 0),
      paid_to_date: parseFloat(po.paid_amount || 0),
      retention_held: 0,
    });
  }

  return commitments;
}

// Process QuickBooks bills
function normalizeBills(qbData: any): Bill[] {
  return (qbData.bills || []).map((bill: any) => ({
    vendor: bill.VendorRef?.name || 'Unknown',
    qb_id: String(bill.Id),
    doc_number: bill.DocNumber || '',
    amount: parseFloat(bill.TotalAmt || 0),
    balance: parseFloat(bill.Balance || 0),
    date: bill.TxnDate || '',
  }));
}

// Run commitment reconciliation
function reconcileCommitments(
  commitments: Commitment[],
  bills: Bill[],
  qbVendors: any[]
): ReconciliationResult[] {
  const results: ReconciliationResult[] = [];

  // Group bills by vendor
  const billsByVendor: Map<string, Bill[]> = new Map();
  for (const bill of bills) {
    const vendor = bill.vendor.toLowerCase();
    if (!billsByVendor.has(vendor)) {
      billsByVendor.set(vendor, []);
    }
    billsByVendor.get(vendor)!.push(bill);
  }

  for (const commitment of commitments) {
    const vendorMatch = findVendorMatch(commitment.vendor, qbVendors);

    let qbValue = 0;
    let qbRef = null;

    if (vendorMatch) {
      const vendorBills = billsByVendor.get(vendorMatch.name.toLowerCase()) || [];
      qbValue = vendorBills.reduce((sum, b) => sum + b.amount, 0);
      qbRef = `${vendorBills.length} bills`;
    }

    const variance = commitment.current_value - qbValue;
    const variancePct = commitment.current_value ? (variance / commitment.current_value) * 100 : 0;
    const severity = calculateSeverity(variance, commitment.current_value);

    let notes = '';
    if (!vendorMatch) {
      notes = `Vendor '${commitment.vendor}' not matched in QuickBooks`;
    } else if (variance !== 0) {
      notes = `Variance of $${Math.abs(variance).toFixed(2)} between systems`;
    }

    results.push({
      id: generateId(),
      item_type: 'commitment',
      description: `${commitment.type}: ${commitment.title || commitment.vendor}`,
      vendor: commitment.vendor,
      procore_value: commitment.current_value,
      qb_value: vendorMatch ? qbValue : null,
      variance,
      variance_pct: variancePct,
      severity,
      notes,
      requires_action: severity !== 'info',
    });
  }

  return results;
}

// Generate closeout items
function generateCloseoutItems(
  commitments: Commitment[],
  reconciliationResults: ReconciliationResult[]
): any[] {
  const items: any[] = [];
  let itemNum = 1;

  // Outstanding retention
  for (const c of commitments) {
    if (c.retention_held > 0) {
      items.push({
        item_id: `CI-${String(itemNum++).padStart(4, '0')}`,
        category: 'retention',
        description: `Release retention for ${c.vendor}`,
        vendor: c.vendor,
        amount_at_risk: c.retention_held,
        action_required: `Verify work completion and release $${c.retention_held.toFixed(2)} retention`,
        priority: 3,
      });
    }
  }

  // Unmatched items from reconciliation
  for (const r of reconciliationResults) {
    if (r.severity === 'critical') {
      items.push({
        item_id: `CI-${String(itemNum++).padStart(4, '0')}`,
        category: 'variance',
        description: `Critical variance: ${r.description}`,
        vendor: r.vendor,
        amount_at_risk: Math.abs(r.variance),
        action_required: r.notes || 'Investigate and resolve variance',
        priority: 1,
      });
    }
  }

  return items;
}

// AI analysis (optional)
async function getAIAnalysis(results: ReconciliationResult[]): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;

  const discrepancies = results.filter(r => r.severity !== 'info');
  if (discrepancies.length === 0) return 'All items reconciled successfully. No discrepancies found.';

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
            content: `You are a construction financial analyst. Summarize these reconciliation discrepancies in 2-3 sentences, focusing on the most important issues:\n\n${JSON.stringify(discrepancies.slice(0, 10), null, 2)}`,
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

    // Normalize data
    const commitments = normalizeCommitments(procoreData);
    const bills = normalizeBills(qbData);
    const qbVendors = qbData.vendors || [];

    // Run reconciliation
    const commitmentResults = reconcileCommitments(commitments, bills, qbVendors);

    // Generate closeout items
    const closeoutItems = generateCloseoutItems(commitments, commitmentResults);

    // Calculate summary
    const totalCommitted = commitments.reduce((sum, c) => sum + c.current_value, 0);
    const totalBilled = commitments.reduce((sum, c) => sum + c.billed_to_date, 0);
    const totalPaid = commitments.reduce((sum, c) => sum + c.paid_to_date, 0);
    const totalRetention = commitments.reduce((sum, c) => sum + c.retention_held, 0);

    const warningCount = commitmentResults.filter(r => r.severity === 'warning').length;
    const criticalCount = commitmentResults.filter(r => r.severity === 'critical').length;
    const totalExposure = closeoutItems.reduce((sum, i) => sum + (i.amount_at_risk || 0), 0);

    // Get AI summary
    const aiSummary = await getAIAnalysis(commitmentResults);

    // Create the report
    const report = {
      project_id: projectId,
      generated_at: new Date().toISOString(),
      total_committed: totalCommitted,
      total_billed_by_subs: totalBilled,
      total_paid_to_subs: totalPaid,
      sub_retention_held: totalRetention,
      reconciled_items: commitmentResults.filter(r => r.severity === 'info').length,
      warning_items: warningCount,
      critical_items: criticalCount,
      open_closeout_items: closeoutItems.length,
      estimated_exposure: totalExposure,
      executive_summary: aiSummary,
      results: commitmentResults,
      closeout_items: closeoutItems,
      commitments: commitments.map(c => ({
        vendor: c.vendor,
        procore_id: c.procore_id,
        commitment_type: c.type,
        title: c.title,
        original_amount: c.original_amount,
        approved_changes: c.approved_changes,
        current_value: c.current_value,
        billed_to_date: c.billed_to_date,
        paid_to_date: c.paid_to_date,
        retention_held: c.retention_held,
        balance_remaining: c.current_value - c.billed_to_date,
      })),
    };

    // Save to Supabase if we have a project ID
    if (projectId && userId) {
      // First ensure project exists
      await supabase.from('projects').upsert({
        id: projectId,
        procore_id: procoreData.project?.id,
        name: procoreData.project?.name || 'Unknown Project',
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
        // Insert results
        if (report.results.length > 0) {
          await supabase.from('reconciliation_results').insert(
            report.results.map(r => ({
              report_id: reportData.id,
              result_id: r.id,
              item_type: r.item_type,
              item_description: r.description,
              vendor: r.vendor,
              procore_value: r.procore_value,
              qb_value: r.qb_value,
              variance: r.variance,
              variance_pct: r.variance_pct,
              severity: r.severity,
              notes: r.notes,
              requires_action: r.requires_action,
            }))
          );
        }

        // Insert closeout items
        if (report.closeout_items.length > 0) {
          await supabase.from('closeout_items').insert(
            report.closeout_items.map(i => ({
              report_id: reportData.id,
              item_id: i.item_id,
              category: i.category,
              description: i.description,
              vendor: i.vendor,
              amount_at_risk: i.amount_at_risk,
              action_required: i.action_required,
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

        report.id = reportData.id;
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
