import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Use env vars if available, otherwise fall back to hardcoded values
// TODO: Remove hardcoded values once env vars are working in Netlify
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://mctfnfczyznsecinspvi.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jdGZuZmN6eXpuc2VjaW5zcHZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTM2MjksImV4cCI6MjA5MTgyOTYyOX0.0uF7wtkT_4qUvLbXnacUijFVjXjEKhL3XComyQUPwXY'

// Check if Supabase is configured
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey)

// Create client only if configured, otherwise create a placeholder that will show helpful errors
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createClient('https://placeholder.supabase.co', 'placeholder-key')

// Type definitions for database tables
export interface Project {
  id: string
  procore_id: number
  name: string
  project_number: string | null
  address: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface ReconciliationReport {
  id: string
  project_id: string
  generated_at: string
  total_contract_value: number
  total_committed: number
  total_billed_by_subs: number
  total_paid_to_subs: number
  sub_retention_held: number
  // Procore vs QBO comparison totals
  procore_sub_invoiced: number | null
  qbo_sub_invoiced: number | null
  procore_sub_paid: number | null
  qbo_sub_paid: number | null
  procore_retention_held: number | null
  qbo_retention_held: number | null
  procore_retention_paid: number | null
  qbo_retention_paid: number | null
  // Separated retainage released vs paid
  procore_retainage_released: number | null
  qbo_retainage_released: number | null
  procore_retainage_paid: number | null
  qbo_retainage_paid: number | null
  procore_labor: number | null
  qbo_labor: number | null
  // Counts and status
  reconciled_items: number
  warning_items: number
  critical_items: number
  open_closeout_items: number
  estimated_exposure: number
  executive_summary: string | null
  ai_analysis: any
  // Closeout eligibility (Phase 8+9)
  soft_close_eligible: boolean | null
  hard_close_eligible: boolean | null
  status: string
  created_at: string
}

export interface ReconciliationResult {
  id: string
  report_id: string
  result_id: string
  item_type: string
  item_description: string | null
  vendor: string | null
  procore_value: number | null
  qb_value: number | null
  variance: number | null
  variance_pct: number | null
  severity: 'info' | 'warning' | 'critical'
  notes: string | null
  procore_ref: string | null
  qb_ref: string | null
  cost_code: string | null
  requires_action: boolean
  ai_likely_cause: string | null
  ai_risk_level: string | null
  ai_recommended_action: string | null
  ai_is_timing_issue: boolean | null
  procore_retainage: number | null
  qb_retainage: number | null
  retainage_released: number | null
  billing_date: string | null
  payment_app_retainage: number | null
  procore_date: string | null
  qb_date: string | null
  created_at: string
}

export interface CloseoutItem {
  id: string
  report_id: string
  item_id: string
  category: string
  description: string
  status: 'open' | 'in_progress' | 'resolved'
  responsible_party: string | null
  vendor: string | null
  amount_at_risk: number
  action_required: string | null
  due_date: string | null
  priority: number
  resolved_at: string | null
  resolved_by: string | null
  resolution_notes: string | null
  created_at: string
  updated_at: string
}

export interface Commitment {
  id: string
  report_id: string
  vendor: string
  procore_id: string | null
  qb_id: string | null
  commitment_type: string | null
  title: string | null
  status: string | null
  original_amount: number | null
  approved_changes: number | null
  pending_changes: number | null
  current_value: number | null
  billed_to_date: number | null
  paid_to_date: number | null
  retention_held: number | null
  balance_remaining: number | null
  cost_codes: string[] | null
  created_at: string
}

// Project with its latest reconciliation report metrics
export interface ProjectWithReport extends Project {
  latest_report?: {
    id: string
    total_committed: number
    warning_items: number
    critical_items: number
    generated_at: string
  } | null
}

// API functions
export async function getProjects(): Promise<ProjectWithReport[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*, reconciliation_reports(*)')
    .order('updated_at', { ascending: false })

  if (error) throw error

  // For each project, pick the most recent report
  return (data || []).map((project: any) => {
    const reports = project.reconciliation_reports || []
    // Sort by generated_at descending, pick first
    const sorted = reports.sort((a: any, b: any) =>
      new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime()
    )
    const latest = sorted[0] || null
    const { reconciliation_reports, ...proj } = project
    return {
      ...proj,
      latest_report: latest ? {
        id: latest.id,
        total_committed: latest.total_committed || 0,
        warning_items: latest.warning_items || 0,
        critical_items: latest.critical_items || 0,
        generated_at: latest.generated_at,
      } : null,
    } as ProjectWithReport
  })
}

export async function getProject(id: string) {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as Project
}

export async function getReportsForProject(projectId: string) {
  const { data, error } = await supabase
    .from('reconciliation_reports')
    .select('*')
    .eq('project_id', projectId)
    .order('generated_at', { ascending: false })

  if (error) throw error
  return data as ReconciliationReport[]
}

export async function getReport(id: string) {
  const { data, error } = await supabase
    .from('reconciliation_reports')
    .select('*, projects(*)')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as ReconciliationReport & { projects: Project }
}

export async function getResultsForReport(reportId: string) {
  const { data, error } = await supabase
    .from('reconciliation_results')
    .select('*')
    .eq('report_id', reportId)
    .order('severity', { ascending: false })

  if (error) throw error
  return data as ReconciliationResult[]
}

export async function getCloseoutItemsForReport(reportId: string) {
  const { data, error } = await supabase
    .from('closeout_items')
    .select('*')
    .eq('report_id', reportId)
    .order('priority', { ascending: true })

  if (error) throw error
  return data as CloseoutItem[]
}

export async function getAllOpenCloseoutItems() {
  const { data, error } = await supabase
    .from('closeout_items')
    .select('*, reconciliation_reports(*, projects(*))')
    .in('status', ['open', 'in_progress'])
    .order('priority', { ascending: true })

  if (error) throw error
  return data
}

export async function updateCloseoutItemStatus(
  id: string,
  status: CloseoutItem['status'],
  resolvedBy?: string,
  resolutionNotes?: string
) {
  const updates: Partial<CloseoutItem> = { status }

  if (status === 'resolved') {
    updates.resolved_at = new Date().toISOString()
    if (resolvedBy) updates.resolved_by = resolvedBy
    if (resolutionNotes) updates.resolution_notes = resolutionNotes
  }

  const { data, error } = await supabase
    .from('closeout_items')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as CloseoutItem
}

export async function getCommitmentsForReport(reportId: string) {
  const { data, error } = await supabase
    .from('commitments')
    .select('*')
    .eq('report_id', reportId)
    .order('vendor', { ascending: true })

  if (error) throw error
  return data as Commitment[]
}

// Get financial tail details for a project (latest report's results + commitments)
export async function getFinancialTailsForProject(projectId: string) {
  // Get latest report
  const { data: reports, error: reportError } = await supabase
    .from('reconciliation_reports')
    .select('*')
    .eq('project_id', projectId)
    .order('generated_at', { ascending: false })
    .limit(1)

  if (reportError) throw reportError
  if (!reports || reports.length === 0) return null

  const report = reports[0] as ReconciliationReport

  // Fetch results and commitments in parallel
  const [resultsRes, commitmentsRes] = await Promise.all([
    supabase
      .from('reconciliation_results')
      .select('*')
      .eq('report_id', report.id)
      .order('severity', { ascending: false }),
    supabase
      .from('commitments')
      .select('*')
      .eq('report_id', report.id)
      .order('vendor', { ascending: true }),
  ])

  if (resultsRes.error) throw resultsRes.error
  if (commitmentsRes.error) throw commitmentsRes.error

  return {
    report,
    results: resultsRes.data as ReconciliationResult[],
    commitments: commitmentsRes.data as Commitment[],
  }
}

// Delete a project and all its associated data (via server-side function to bypass RLS)
export async function deleteProject(projectId: string) {
  const response = await fetch('/.netlify/functions/delete-report', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to delete project')
  }

  return true
}

// Summary statistics
export async function getDashboardStats() {
  // Get total projects
  const { count: projectCount } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true })

  // Get latest reports for each project
  const { data: reports } = await supabase
    .from('reconciliation_reports')
    .select('*')
    .order('generated_at', { ascending: false })

  // Get open closeout items count
  const { count: openItemsCount } = await supabase
    .from('closeout_items')
    .select('*', { count: 'exact', head: true })
    .in('status', ['open', 'in_progress'])

  // Calculate totals from latest reports
  const totalExposure = reports?.reduce(
    (sum, r) => sum + (r.estimated_exposure || 0),
    0
  ) || 0

  const totalWarnings = reports?.reduce(
    (sum, r) => sum + (r.warning_items || 0),
    0
  ) || 0

  const totalCritical = reports?.reduce(
    (sum, r) => sum + (r.critical_items || 0),
    0
  ) || 0

  return {
    projectCount: projectCount || 0,
    openItemsCount: openItemsCount || 0,
    totalExposure,
    totalWarnings,
    totalCritical,
  }
}

// ===== Soft Closed Projects =====
export interface SoftClosedProject {
  id: string
  project_id: string
  soft_closed_at: string
  soft_closed_by: string | null
  notes: string | null
  open_aps: number | null  // Open accounts payable count
  open_ars: number | null  // Open accounts receivable count
  pending_invoices: number | null  // Pending sub invoices
  created_at: string
}

export async function getSoftClosedProjects() {
  const { data, error } = await supabase
    .from('soft_closed_projects')
    .select('*, projects(*)')
    .order('soft_closed_at', { ascending: false })

  if (error) throw error
  return data as (SoftClosedProject & { projects: Project })[]
}

export async function softCloseProject(
  projectId: string,
  userId: string,
  notes?: string,
  openAps?: number,
  openArs?: number,
  pendingInvoices?: number
) {
  const { data, error } = await supabase
    .from('soft_closed_projects')
    .insert({
      project_id: projectId,
      soft_closed_by: userId,
      notes: notes || null,
      open_aps: openAps || 0,
      open_ars: openArs || 0,
      pending_invoices: pendingInvoices || 0,
    })
    .select()
    .single()

  if (error) throw error
  return data as SoftClosedProject
}

export async function removeSoftClose(projectId: string) {
  const { error } = await supabase
    .from('soft_closed_projects')
    .delete()
    .eq('project_id', projectId)

  if (error) throw error
  return true
}

export async function isProjectSoftClosed(projectId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('soft_closed_projects')
    .select('id')
    .eq('project_id', projectId)
    .maybeSingle()

  if (error) throw error
  return !!data
}

// ===== WIP Reports (Work In Progress) =====
export interface WIPReport {
  id: string
  month_end_date: string  // The last day of the month this WIP covers
  generated_at: string
  generated_by: string | null
  total_projects: number
  total_contract_value: number
  total_cost_to_date: number
  total_billing_to_date: number
  total_over_under_billing: number  // Positive = over-billed, negative = under-billed
  total_projected_gross_profit: number
  report_data: any  // JSON blob with detailed project-by-project data
  status: 'draft' | 'finalized'
  finalized_at: string | null
  created_at: string
}

export async function getWIPReports() {
  const { data, error } = await supabase
    .from('wip_reports')
    .select('*')
    .order('month_end_date', { ascending: false })

  if (error) throw error
  return data as WIPReport[]
}

export async function getWIPReport(id: string) {
  const { data, error } = await supabase
    .from('wip_reports')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as WIPReport
}

export async function createWIPReport(
  monthEndDate: string,
  userId: string,
  reportData: any
) {
  const totals = calculateWIPTotals(reportData)

  const { data, error } = await supabase
    .from('wip_reports')
    .insert({
      month_end_date: monthEndDate,
      generated_by: userId,
      total_projects: totals.totalProjects,
      total_contract_value: totals.totalContractValue,
      total_cost_to_date: totals.totalCostToDate,
      total_billing_to_date: totals.totalBillingToDate,
      total_over_under_billing: totals.totalOverUnderBilling,
      total_projected_gross_profit: totals.totalProjectedGrossProfit,
      report_data: reportData,
      status: 'draft',
    })
    .select()
    .single()

  if (error) throw error
  return data as WIPReport
}

export async function finalizeWIPReport(id: string) {
  const { data, error } = await supabase
    .from('wip_reports')
    .update({
      status: 'finalized',
      finalized_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as WIPReport
}

function calculateWIPTotals(reportData: any) {
  const projects = reportData?.projects || []
  return {
    totalProjects: projects.length,
    totalContractValue: projects.reduce((sum: number, p: any) => sum + (p.contractValue || 0), 0),
    totalCostToDate: projects.reduce((sum: number, p: any) => sum + (p.costToDate || 0), 0),
    totalBillingToDate: projects.reduce((sum: number, p: any) => sum + (p.billingToDate || 0), 0),
    totalOverUnderBilling: projects.reduce((sum: number, p: any) => sum + (p.overUnderBilling || 0), 0),
    totalProjectedGrossProfit: projects.reduce((sum: number, p: any) => sum + (p.projectedGrossProfit || 0), 0),
  }
}
