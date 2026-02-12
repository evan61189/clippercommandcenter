import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Use env vars if available, otherwise fall back to hardcoded values
// TODO: Remove hardcoded values once env vars are working in Netlify
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://eruvdljuqvvoxfnlraje.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVydXZkbGp1cXZ2b3hmbmxyYWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNTc5ODksImV4cCI6MjA4NTgzMzk4OX0.JeR6g6NJa7c9yohW19OWlS-EMKg650Jwf4WYXYQGBhU'

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

// API functions
export async function getProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) throw error
  return data as Project[]
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
