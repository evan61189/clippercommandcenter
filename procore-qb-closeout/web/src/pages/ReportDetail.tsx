import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import {
  ArrowLeft,
  AlertCircle,
  AlertTriangle,
  FileText,
  CheckCircle,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  Lock,
  Unlock,
  X,
  DollarSign,
} from 'lucide-react'
import {
  getReport,
  getResultsForReport,
  getCloseoutItemsForReport,
  getCommitmentsForReport,
  softCloseProject,
  isProjectSoftClosed,
} from '../lib/supabase'
import AIChat from '../components/AIChat'
import {
  formatCurrency,
  formatDateTime,
  getSeverityColor,
  getSeverityText,
  getStatusColor,
  getPriorityLabel,
  getPriorityColor,
} from '../lib/utils'

type TabType = 'summary' | 'sub_invoices' | 'owner_invoices' | 'direct_costs' | 'labor' | 'warnings' | 'closeout'

function getUserId(): string {
  let userId = localStorage.getItem('closeout_user_id')
  if (!userId) {
    userId = 'user_' + Math.random().toString(36).substring(2, 15)
    localStorage.setItem('closeout_user_id', userId)
  }
  return userId
}

export default function ReportDetail() {
  const { reportId } = useParams<{ reportId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<TabType>('summary')
  const [severityFilter, setSeverityFilter] = useState<'warning' | 'critical' | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isSoftClosing, setIsSoftClosing] = useState(false)
  const [isSoftClosed, setIsSoftClosed] = useState(false)
  const [expandedTail, setExpandedTail] = useState<'open_aps' | 'open_ars' | 'pending_invoices' | null>(null)

  // Handle ?filter= query param from dashboard links
  useEffect(() => {
    const filter = searchParams.get('filter')
    if (filter === 'warning' || filter === 'critical') {
      setSeverityFilter(filter)
    }
  }, [searchParams])

  function clearSeverityFilter() {
    setSeverityFilter(null)
    setSearchParams({})
  }

  const { data: report, isLoading: reportLoading, refetch: refetchReport } = useQuery({
    queryKey: ['report', reportId],
    queryFn: () => getReport(reportId!),
    enabled: !!reportId,
  })

  const { data: results, isLoading: resultsLoading, refetch: refetchResults } = useQuery({
    queryKey: ['report-results', reportId],
    queryFn: () => getResultsForReport(reportId!),
    enabled: !!reportId,
  })

  const { data: closeoutItems, isLoading: closeoutLoading, refetch: refetchCloseout } = useQuery({
    queryKey: ['report-closeout', reportId],
    queryFn: () => getCloseoutItemsForReport(reportId!),
    enabled: !!reportId,
  })

  const { data: commitments } = useQuery({
    queryKey: ['report-commitments', reportId],
    queryFn: () => getCommitmentsForReport(reportId!),
    enabled: !!reportId,
  })

  // Check if project is already soft closed
  const { data: softClosedStatus } = useQuery({
    queryKey: ['soft-closed-status', report?.project_id],
    queryFn: async () => {
      if (!report?.project_id) return false
      return isProjectSoftClosed(report.project_id)
    },
    enabled: !!report?.project_id,
  })

  // Update soft closed state when query completes
  useState(() => {
    if (softClosedStatus !== undefined) {
      setIsSoftClosed(softClosedStatus)
    }
  })

  async function handleSoftClose() {
    if (!report?.project_id || isSoftClosing) return

    const confirmed = confirm(
      'Are you sure you want to soft close this project?\n\n' +
      'Soft closing indicates the project has reached substantial completion but may still have outstanding financial tails.'
    )

    if (!confirmed) return

    setIsSoftClosing(true)
    try {
      // Calculate outstanding items from available data
      // Open APs: sub invoices matched to QB bills where vendor has unpaid amounts
      // Use ai_analysis from backend if available, otherwise derive from commitments/results
      let openAps = report.ai_analysis?.open_ap_count ?? 0
      let openArs = report.ai_analysis?.open_ar_count ?? 0
      let pendingInvoices = report.ai_analysis?.pending_invoice_count ?? 0

      // If backend didn't populate ai_analysis, calculate from frontend data
      if (!report.ai_analysis) {
        // Open APs: count sub invoices matched to QB bills where vendor is NOT fully paid
        const matchedSubInvoices = results?.filter(r =>
          r.item_type === 'invoice' && r.qb_ref
        ) || []
        // Cross-reference with commitments to exclude fully paid vendors
        const unpaidInvoices = matchedSubInvoices.filter(r => {
          const commitment = commitments?.find(c =>
            c.vendor && r.vendor &&
            c.vendor.toLowerCase().trim() === r.vendor.toLowerCase().trim()
          )
          if (!commitment) return true
          return (commitment.paid_to_date || 0) < (commitment.billed_to_date || 0) - 0.01
        })
        openAps = unpaidInvoices.length

        // Open ARs: owner invoices/pay apps that aren't fully matched or have issues
        const unmatchedOwnerInvoices = results?.filter(r =>
          r.item_type === 'payment_app' && r.severity !== 'info'
        ) || []
        openArs = unmatchedOwnerInvoices.length

        // Pending invoices: commitments with retainage held or unbilled amounts
        const pendingCommitments = commitments?.filter(c =>
          (c.retention_held || 0) > 0 ||
          (c.current_value || 0) > (c.billed_to_date || 0) + 0.01
        ) || []
        pendingInvoices = pendingCommitments.length
      }

      await softCloseProject(
        report.project_id,
        getUserId(),
        undefined,
        openAps,
        openArs,
        pendingInvoices
      )

      setIsSoftClosed(true)
      alert('Project has been soft closed successfully!')
    } catch (error: any) {
      console.error('Error soft closing project:', error)
      alert(`Failed to soft close project: ${error.message}`)
    } finally {
      setIsSoftClosing(false)
    }
  }

  async function handleUpdate() {
    // TODO: Implement re-pull from Procore and QuickBooks
    setIsUpdating(true)
    try {
      // For now, just refetch the data from the database
      await Promise.all([refetchReport(), refetchResults(), refetchCloseout()])
      alert('Report data refreshed. Full re-pull from Procore/QuickBooks coming soon.')
    } catch (error) {
      console.error('Error updating report:', error)
      alert('Failed to update report.')
    } finally {
      setIsUpdating(false)
    }
  }

  if (reportLoading || resultsLoading || closeoutLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-procore-blue"></div>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900">Report not found</h2>
        <Link to="/" className="text-procore-blue hover:underline mt-2 inline-block">
          Return to Dashboard
        </Link>
      </div>
    )
  }

  // Filter results by type
  const subInvoiceResultsRaw = results?.filter(r => r.item_type === 'invoice') || []
  const ownerInvoiceResults = results?.filter(r => r.item_type === 'payment_app') || []
  const directCostResults = results?.filter(r => r.item_type === 'direct_cost') || []
  const laborResults = results?.filter(r => r.item_type === 'labor') || []

  // When no reconciliation results exist for sub invoices but the report has
  // backend-computed open_ap_items (from QB bill balances), use those so the
  // Sub Invoices tab isn't empty while Open APs shows items.
  const aiAnalysis = report.ai_analysis as any
  const openApItems = aiAnalysis?.open_ap_items || []
  const subInvoiceResults = subInvoiceResultsRaw.length > 0
    ? subInvoiceResultsRaw
    : openApItems.map((item: any, idx: number) => ({
        id: `ap-${idx}`,
        report_id: report.id,
        result_id: `ap-${idx}`,
        item_type: 'invoice',
        item_description: `QB Bill #${item.bill_ref || 'N/A'}`,
        vendor: item.vendor || null,
        procore_value: item.amount ?? null,
        qb_value: item.amount ?? null,
        variance: item.balance != null && item.amount != null ? item.balance - item.amount : 0,
        variance_pct: null,
        severity: 'info' as const,
        notes: item.balance > 0 ? `Reconciled — outstanding balance: ${formatCurrency(item.balance)}` : 'Reconciled — paid in full',
        procore_ref: null,
        qb_ref: item.bill_ref ? `Bill #${item.bill_ref}` : null,
        requires_action: item.balance > 0,
        created_at: '',
      }))

  // Generate warnings based on the data
  const warnings = generateWarnings(results || [], commitments || [], report)

  const tabs = [
    { id: 'summary' as TabType, label: 'Summary', count: null },
    { id: 'sub_invoices' as TabType, label: 'Sub Invoices', count: subInvoiceResults.length },
    { id: 'owner_invoices' as TabType, label: 'Owner Invoices', count: ownerInvoiceResults.length },
    { id: 'direct_costs' as TabType, label: 'Direct Costs', count: directCostResults.length },
    { id: 'labor' as TabType, label: 'Labor', count: laborResults.length },
    { id: 'warnings' as TabType, label: 'Warnings', count: warnings.length },
    { id: 'closeout' as TabType, label: 'Closeout Items', count: closeoutItems?.length || 0 },
  ]

  const projectName = report.projects?.name || 'Unknown Project'

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        to={report.projects ? `/project/${report.projects.id}` : '/'}
        className="flex items-center text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Project
      </Link>

      {/* Report Header */}
      <div className="card">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Closeout Reconciliation Report - {projectName}
            </h1>
            <p className="text-gray-500 mt-1">
              Generated {formatDateTime(report.generated_at)}
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={handleUpdate}
              disabled={isUpdating}
              className="flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {isUpdating ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Update
            </button>
            {/* Soft Close Button */}
            <button
              disabled={!report.soft_close_eligible || isSoftClosing || isSoftClosed || softClosedStatus}
              title={
                isSoftClosed || softClosedStatus
                  ? 'Project is already soft closed'
                  : report.soft_close_eligible
                  ? 'All items reconciled - ready for soft close'
                  : 'Not all items are reconciled'
              }
              className={`flex items-center px-4 py-2 text-sm font-medium rounded-lg ${
                isSoftClosed || softClosedStatus
                  ? 'text-white bg-yellow-600'
                  : report.soft_close_eligible
                  ? 'text-white bg-yellow-500 hover:bg-yellow-600'
                  : 'text-gray-400 bg-gray-100 cursor-not-allowed'
              }`}
              onClick={handleSoftClose}
            >
              {isSoftClosing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Unlock className="w-4 h-4 mr-2" />
              )}
              {isSoftClosed || softClosedStatus ? 'Soft Closed' : 'Soft Close'}
            </button>
            {/* Hard Close Button */}
            <button
              disabled={!report.hard_close_eligible}
              title={report.hard_close_eligible ? 'All payments complete - ready for hard close' : 'Soft close required first, or payments incomplete'}
              className={`flex items-center px-4 py-2 text-sm font-medium rounded-lg ${
                report.hard_close_eligible
                  ? 'text-white bg-green-600 hover:bg-green-700'
                  : 'text-gray-400 bg-gray-100 cursor-not-allowed'
              }`}
              onClick={() => report.hard_close_eligible && alert('Hard Close functionality coming soon!')}
            >
              <Lock className="w-4 h-4 mr-2" />
              Hard Close
            </button>
            <span className={`badge ${report.status === 'complete' ? 'badge-info' : 'badge-warning'}`}>
              {report.status}
            </span>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-500">Contract Value</p>
            <p className="text-xl font-semibold">
              {formatCurrency(report.total_contract_value)}
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-500">Total Committed</p>
            <p className="text-xl font-semibold">
              {formatCurrency(report.total_committed)}
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-500">Retention Held</p>
            <p className="text-xl font-semibold">
              {formatCurrency(report.sub_retention_held)}
            </p>
          </div>
        </div>

        {/* Procore vs QBO Comparison */}
        <div className="mt-6 pt-6 border-t">
          <h3 className="text-sm font-medium text-gray-700 mb-4">Procore vs QuickBooks Comparison</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-medium text-gray-500">Category</th>
                  <th className="text-right py-2 px-4 font-medium text-gray-500">Procore</th>
                  <th className="text-right py-2 px-4 font-medium text-gray-500">QuickBooks</th>
                  <th className="text-right py-2 pl-4 font-medium text-gray-500">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Subcontractors Invoiced</td>
                  <td className="py-2 px-4 text-right font-medium">{formatCurrency(report.procore_sub_invoiced || 0)}</td>
                  <td className="py-2 px-4 text-right font-medium">{formatCurrency(report.qbo_sub_invoiced || 0)}</td>
                  <td className={`py-2 pl-4 text-right font-medium ${
                    (report.procore_sub_invoiced || 0) - (report.qbo_sub_invoiced || 0) !== 0 ? 'text-red-600' : 'text-green-600'
                  }`}>
                    {formatCurrency((report.procore_sub_invoiced || 0) - (report.qbo_sub_invoiced || 0))}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Subcontractors Paid</td>
                  <td className="py-2 px-4 text-right font-medium">{formatCurrency(report.procore_sub_paid || 0)}</td>
                  <td className="py-2 px-4 text-right font-medium">{formatCurrency(report.qbo_sub_paid || 0)}</td>
                  <td className={`py-2 pl-4 text-right font-medium ${
                    (report.procore_sub_paid || 0) - (report.qbo_sub_paid || 0) !== 0 ? 'text-red-600' : 'text-green-600'
                  }`}>
                    {formatCurrency((report.procore_sub_paid || 0) - (report.qbo_sub_paid || 0))}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Retention Held</td>
                  <td className="py-2 px-4 text-right font-medium">{formatCurrency(report.procore_retention_held || 0)}</td>
                  <td className="py-2 px-4 text-right font-medium">{formatCurrency(report.qbo_retention_held || 0)}</td>
                  <td className={`py-2 pl-4 text-right font-medium ${
                    (report.procore_retention_held || 0) - (report.qbo_retention_held || 0) !== 0 ? 'text-red-600' : 'text-green-600'
                  }`}>
                    {formatCurrency((report.procore_retention_held || 0) - (report.qbo_retention_held || 0))}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Retention Paid</td>
                  <td className="py-2 px-4 text-right font-medium">{formatCurrency(report.procore_retention_paid || 0)}</td>
                  <td className="py-2 px-4 text-right font-medium">{formatCurrency(report.qbo_retention_paid || 0)}</td>
                  <td className={`py-2 pl-4 text-right font-medium ${
                    (report.procore_retention_paid || 0) - (report.qbo_retention_paid || 0) !== 0 ? 'text-red-600' : 'text-green-600'
                  }`}>
                    {formatCurrency((report.procore_retention_paid || 0) - (report.qbo_retention_paid || 0))}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Labor</td>
                  <td className="py-2 px-4 text-right font-medium">{formatCurrency(report.procore_labor || 0)}</td>
                  <td className="py-2 px-4 text-right font-medium">{formatCurrency(report.qbo_labor || 0)}</td>
                  <td className={`py-2 pl-4 text-right font-medium ${
                    (report.procore_labor || 0) - (report.qbo_labor || 0) !== 0 ? 'text-red-600' : 'text-green-600'
                  }`}>
                    {formatCurrency((report.procore_labor || 0) - (report.qbo_labor || 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Status Summary */}
        <div className="flex items-center space-x-6 mt-6 pt-6 border-t">
          <div className="flex items-center">
            <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
            <span className="text-sm">
              <strong>{report.reconciled_items}</strong> Reconciled
            </span>
          </div>
          <div className="flex items-center">
            <AlertCircle className="w-5 h-5 text-yellow-500 mr-2" />
            <span className="text-sm">
              <strong>{report.warning_items}</strong> Warnings
            </span>
          </div>
          <div className="flex items-center">
            <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
            <span className="text-sm">
              <strong>{report.critical_items}</strong> Critical
            </span>
          </div>
          <div className="flex items-center">
            <FileText className="w-5 h-5 text-blue-500 mr-2" />
            <span className="text-sm">
              <strong>{report.open_closeout_items}</strong> Open Items
            </span>
          </div>
        </div>
      </div>

      {/* Severity Filter Banner */}
      {severityFilter && (
        <div className={`rounded-lg p-4 flex items-center justify-between ${
          severityFilter === 'critical'
            ? 'bg-red-50 border border-red-200'
            : 'bg-yellow-50 border border-yellow-200'
        }`}>
          <div className="flex items-center">
            {severityFilter === 'critical' ? (
              <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-yellow-500 mr-2" />
            )}
            <span className={`font-medium ${
              severityFilter === 'critical' ? 'text-red-700' : 'text-yellow-700'
            }`}>
              Showing {severityFilter === 'critical' ? 'critical issues' : 'warnings'} only
              ({(results || []).filter(r => r.severity === severityFilter).length} items)
            </span>
          </div>
          <button
            onClick={clearSeverityFilter}
            className={`flex items-center px-3 py-1 text-sm font-medium rounded-lg ${
              severityFilter === 'critical'
                ? 'text-red-700 hover:bg-red-100'
                : 'text-yellow-700 hover:bg-yellow-100'
            }`}
          >
            <X className="w-4 h-4 mr-1" />
            Clear Filter
          </button>
        </div>
      )}

      {/* Filtered Results View (when severity filter is active) */}
      {severityFilter ? (
        <div className="card">
          <GroupedResultsTable
            results={(results || []).filter(r => r.severity === severityFilter)}
            title={severityFilter === 'critical' ? 'Critical Issues' : 'Warnings'}
          />
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === tab.id
                      ? 'border-procore-blue text-procore-blue'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.label}
                  {tab.count !== null && (
                    <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-gray-100">
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="card">
            {activeTab === 'summary' && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold">Executive Summary</h2>
                {report.executive_summary ? (
                  <div className="prose max-w-none">
                    <p className="whitespace-pre-wrap text-gray-700">
                      {report.executive_summary}
                    </p>
                  </div>
                ) : (
                  <p className="text-gray-500 italic">
                    No executive summary available. Run AI analysis to generate.
                  </p>
                )}

                {/* Financial Tails */}
                <FinancialTails
                  results={results || []}
                  commitments={commitments || []}
                  aiAnalysis={report.ai_analysis}
                  expandedTail={expandedTail}
                  onToggle={(type) => setExpandedTail(expandedTail === type ? null : type)}
                />
              </div>
            )}

            {activeTab === 'sub_invoices' && (
              <GroupedResultsTable results={subInvoiceResults} title="Subcontractor Invoices" />
            )}

            {activeTab === 'owner_invoices' && (
              <ResultsTable results={ownerInvoiceResults} title="Owner Invoices" />
            )}

            {activeTab === 'direct_costs' && (
              <ResultsTable results={directCostResults} title="Direct Costs" />
            )}

            {activeTab === 'labor' && (
              <ResultsTable results={laborResults} title="Labor Costs" />
            )}

            {activeTab === 'warnings' && (
              <WarningsTable warnings={warnings} />
            )}

            {activeTab === 'closeout' && (
              <CloseoutItemsTable items={closeoutItems || []} />
            )}
          </div>
        </>
      )}

      {/* AI Chat for project questions */}
      <AIChat
        projectId={report.project_id}
        projectName={projectName}
        reportId={reportId}
        contextData={{
          projectName,
          totalCommitted: report.total_committed,
          totalBilled: report.total_billed_by_subs,
          retentionHeld: report.sub_retention_held,
          procoreSubInvoiced: report.procore_sub_invoiced,
          qboSubInvoiced: report.qbo_sub_invoiced,
          procoreSubPaid: report.procore_sub_paid,
          qboSubPaid: report.qbo_sub_paid,
          reconciled: report.reconciled_items,
          warnings: report.warning_items,
          critical: report.critical_items,
          softCloseEligible: report.soft_close_eligible,
          hardCloseEligible: report.hard_close_eligible,
        }}
      />
    </div>
  )
}

// Warning types based on requirements
interface Warning {
  id: string
  type: string
  severity: 'warning' | 'critical'
  message: string
  details?: string
  vendor?: string
}

function generateWarnings(results: any[], commitments: any[], _report: any): Warning[] {
  const warnings: Warning[] = []
  let warningId = 0

  // Check for Owner Invoices not in Approved status
  const unapprovedOwnerInvoices = results.filter(
    r => r.item_type === 'payment_app' && r.notes?.toLowerCase().includes('not approved')
  )
  if (unapprovedOwnerInvoices.length > 0) {
    warnings.push({
      id: String(++warningId),
      type: 'owner_invoice_status',
      severity: 'warning',
      message: 'There are Owner Invoices that are not in the Approved status',
      details: `${unapprovedOwnerInvoices.length} owner invoice(s) pending approval`,
    })
  }

  // Check for Sub Invoices not in Approved status
  const unapprovedSubInvoices = results.filter(
    r => r.item_type === 'invoice' && r.notes?.toLowerCase().includes('not approved')
  )
  if (unapprovedSubInvoices.length > 0) {
    warnings.push({
      id: String(++warningId),
      type: 'sub_invoice_status',
      severity: 'warning',
      message: 'There are Subcontractor Invoices that are not in the Approved status',
      details: `${unapprovedSubInvoices.length} sub invoice(s) pending approval`,
    })
  }

  // Check for invoices not pushed to ERP
  const unpushedOwnerInvoices = results.filter(
    r => r.item_type === 'payment_app' && !r.qb_ref
  )
  if (unpushedOwnerInvoices.length > 0) {
    warnings.push({
      id: String(++warningId),
      type: 'owner_invoice_erp',
      severity: 'warning',
      message: 'There are Approved Owner Invoices that were not pushed to the Procore ERP system',
      details: `${unpushedOwnerInvoices.length} owner invoice(s) not in QuickBooks`,
    })
  }

  const unpushedSubInvoices = results.filter(
    r => r.item_type === 'invoice' && !r.qb_ref
  )
  if (unpushedSubInvoices.length > 0) {
    warnings.push({
      id: String(++warningId),
      type: 'sub_invoice_erp',
      severity: 'warning',
      message: 'There are Approved Subcontractor Invoices that were not pushed to the Procore ERP system',
      details: `${unpushedSubInvoices.length} sub invoice(s) not in QuickBooks`,
    })
  }

  // Check for commitments not in proper status
  // Accept all valid "closed" Procore statuses and skip commitments with no status data
  const validStatuses = ['approved', 'complete', 'completed', 'executed', 'closed', 'void', 'voided', 'terminated']
  const uncommittedContracts = commitments?.filter(
    c => c.status && !validStatuses.includes(c.status.toLowerCase())
  )
  if (uncommittedContracts && uncommittedContracts.length > 0) {
    warnings.push({
      id: String(++warningId),
      type: 'commitment_status',
      severity: 'warning',
      message: 'There are Commitments that are not in the Approved, Void, or Terminated status',
      details: `${uncommittedContracts.length} commitment(s) in pending status`,
    })
  }

  // Check for overbilled commitments
  const overbilledCommitments = commitments?.filter(
    c => c.billed_to_date > c.current_value
  )
  if (overbilledCommitments && overbilledCommitments.length > 0) {
    for (const c of overbilledCommitments) {
      warnings.push({
        id: String(++warningId),
        type: 'overbilled',
        severity: 'critical',
        message: 'Subcontractor has invoiced for more than their Contract Amount',
        details: `Billed: ${formatCurrency(c.billed_to_date)} vs Contract: ${formatCurrency(c.current_value)}`,
        vendor: c.vendor,
      })
    }
  }

  // Check for overpaid commitments
  const overpaidCommitments = commitments?.filter(
    c => c.paid_to_date > c.billed_to_date
  )
  if (overpaidCommitments && overpaidCommitments.length > 0) {
    for (const c of overpaidCommitments) {
      warnings.push({
        id: String(++warningId),
        type: 'overpaid',
        severity: 'critical',
        message: 'Subcontractor has been paid more than their total Invoiced Amount',
        details: `Paid: ${formatCurrency(c.paid_to_date)} vs Invoiced: ${formatCurrency(c.billed_to_date)}`,
        vendor: c.vendor,
      })
    }
  }

  // Check for missing payroll/labor in direct costs
  const hasLaborEntry = results.some(
    r => r.item_type === 'direct_cost' && (
      r.item_description?.toLowerCase().includes('payroll') ||
      r.item_description?.toLowerCase().includes('labor') ||
      r.item_description?.toLowerCase().includes('general conditions') ||
      r.item_description?.toLowerCase().includes('wages') ||
      r.item_description?.toLowerCase().includes('salary')
    )
  )
  if (!hasLaborEntry && results.some(r => r.item_type === 'direct_cost')) {
    warnings.push({
      id: String(++warningId),
      type: 'missing_payroll',
      severity: 'warning',
      message: 'Missing Payroll/Labor Entry in Direct Costs',
      details: 'No payroll, labor, or general conditions entries found for this project',
    })
  }

  return warnings
}

// Detail modal for viewing full Procore/QB data for a line item
function InvoiceDetailModal({ result, onClose }: { result: any; onClose: () => void }) {
  if (!result) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" onClick={onClose}>
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="fixed inset-0 bg-black/50" />
        <div
          className="relative bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between rounded-t-xl">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                {result.item_description || result.vendor || 'Line Item Detail'}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span className={`badge text-xs ${getSeverityColor(result.severity)}`}>
                  {getSeverityText(result.severity)}
                </span>
                <span className={`badge text-xs ${getStatusColor(result.status)}`}>
                  {result.status?.replace(/_/g, ' ') || '-'}
                </span>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* Side-by-side comparison */}
            <div className="grid grid-cols-2 gap-4">
              {/* Procore side */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-blue-800 uppercase tracking-wide mb-3">Procore</h4>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-blue-600">Reference</dt>
                    <dd className="font-medium text-gray-900">{result.procore_ref || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-blue-600">Amount</dt>
                    <dd className="font-medium text-gray-900 text-lg">
                      {result.procore_value != null ? formatCurrency(result.procore_value) : '-'}
                    </dd>
                  </div>
                  {result.procore_retainage != null && result.procore_retainage !== 0 && (
                    <div>
                      <dt className="text-blue-600">Retainage</dt>
                      <dd className="font-medium text-orange-600">{formatCurrency(result.procore_retainage)}</dd>
                    </div>
                  )}
                  {result.procore_date && (
                    <div>
                      <dt className="text-blue-600">Date</dt>
                      <dd className="font-medium text-gray-900">{result.procore_date}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* QuickBooks side */}
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-green-800 uppercase tracking-wide mb-3">QuickBooks</h4>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-green-600">Reference</dt>
                    <dd className="font-medium text-gray-900">{result.qb_ref || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-green-600">Amount</dt>
                    <dd className="font-medium text-gray-900 text-lg">
                      {result.qb_value != null ? formatCurrency(result.qb_value) : '-'}
                    </dd>
                  </div>
                  {result.qb_retainage != null && result.qb_retainage !== 0 && (
                    <div>
                      <dt className="text-green-600">Retainage</dt>
                      <dd className="font-medium text-orange-600">{formatCurrency(result.qb_retainage)}</dd>
                    </div>
                  )}
                  {result.qb_date && (
                    <div>
                      <dt className="text-green-600">Date</dt>
                      <dd className="font-medium text-gray-900">{result.qb_date}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>

            {/* Variance */}
            <div className="bg-gray-50 border rounded-lg p-4">
              <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Variance</h4>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <dt className="text-gray-500">Amount</dt>
                  <dd className={`text-lg font-semibold ${
                    (result.variance || 0) > 0 ? 'text-red-600' : (result.variance || 0) < 0 ? 'text-green-600' : 'text-gray-500'
                  }`}>
                    {result.variance != null ? formatCurrency(result.variance) : '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Percentage</dt>
                  <dd className={`text-lg font-semibold ${
                    (result.variance_pct || 0) > 0 ? 'text-red-600' : (result.variance_pct || 0) < 0 ? 'text-green-600' : 'text-gray-500'
                  }`}>
                    {result.variance_pct != null ? `${result.variance_pct.toFixed(1)}%` : '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Requires Action</dt>
                  <dd className="font-medium">{result.requires_action ? 'Yes' : 'No'}</dd>
                </div>
              </div>
            </div>

            {/* General details */}
            <div className="bg-gray-50 border rounded-lg p-4">
              <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Details</h4>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-gray-500">Vendor</dt>
                  <dd className="font-medium text-gray-900">{result.vendor || '-'}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Type</dt>
                  <dd className="font-medium text-gray-900">{result.item_type?.replace(/_/g, ' ') || '-'}</dd>
                </div>
                {result.cost_code && (
                  <div>
                    <dt className="text-gray-500">Cost Code</dt>
                    <dd className="font-medium text-gray-900">{result.cost_code}</dd>
                  </div>
                )}
                {result.notes && (
                  <div className="col-span-2">
                    <dt className="text-gray-500">Notes</dt>
                    <dd className="font-medium text-gray-900">{result.notes}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* AI Analysis (if available) */}
            {(result.ai_likely_cause || result.ai_recommended_action || result.ai_risk_level) && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-purple-800 uppercase tracking-wide mb-3">AI Analysis</h4>
                <dl className="space-y-2 text-sm">
                  {result.ai_likely_cause && (
                    <div>
                      <dt className="text-purple-600">Likely Cause</dt>
                      <dd className="font-medium text-gray-900">{result.ai_likely_cause}</dd>
                    </div>
                  )}
                  {result.ai_risk_level && (
                    <div>
                      <dt className="text-purple-600">Risk Level</dt>
                      <dd className="font-medium text-gray-900">{result.ai_risk_level}</dd>
                    </div>
                  )}
                  {result.ai_recommended_action && (
                    <div>
                      <dt className="text-purple-600">Recommended Action</dt>
                      <dd className="font-medium text-gray-900">{result.ai_recommended_action}</dd>
                    </div>
                  )}
                  {result.ai_is_timing_issue != null && (
                    <div>
                      <dt className="text-purple-600">Timing Issue</dt>
                      <dd className="font-medium text-gray-900">{result.ai_is_timing_issue ? 'Yes' : 'No'}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

type SortField = 'item_description' | 'vendor' | 'procore_value' | 'qb_value' | 'variance' | 'severity' | 'notes' | 'status' | 'procore_ref' | 'qb_ref'
type SortDir = 'asc' | 'desc'

function ResultsTable({ results, title }: { results: any[]; title?: string }) {
  const [sortField, setSortField] = useState<SortField>('vendor')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [selectedResult, setSelectedResult] = useState<any>(null)

  if (results.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No {title?.toLowerCase() || 'results'} in this category</p>
      </div>
    )
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const sortedResults = [...results].sort((a, b) => {
    let aVal = a[sortField]
    let bVal = b[sortField]

    // Handle nulls
    if (aVal == null) aVal = ''
    if (bVal == null) bVal = ''

    // String comparison for text fields
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      const cmp = aVal.toLowerCase().localeCompare(bVal.toLowerCase())
      return sortDir === 'asc' ? cmp : -cmp
    }

    // Numeric comparison
    const diff = (Number(aVal) || 0) - (Number(bVal) || 0)
    return sortDir === 'asc' ? diff : -diff
  })

  const SortHeader = ({ field, label, className = '' }: { field: SortField; label: string; className?: string }) => (
    <th
      className={`table-header px-3 py-2 cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap ${className}`}
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortField === field && (
          <span className="text-procore-blue font-bold">{sortDir === 'asc' ? '↑' : '↓'}</span>
        )}
      </div>
    </th>
  )

  return (
    <div className="overflow-x-auto">
      {title && <h3 className="text-lg font-medium mb-4">{title}</h3>}
      <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-3">
        <p className="text-sm text-blue-700">
          <strong>Sorting:</strong> Click any column header to sort. Currently sorted by: <strong>{sortField}</strong> ({sortDir})
        </p>
      </div>
      <table className="min-w-full divide-y divide-gray-200 text-xs">
        <thead className="bg-gray-50">
          <tr>
            <SortHeader field="vendor" label="Vendor" />
            <SortHeader field="item_description" label="Description" />
            <SortHeader field="status" label="Status" />
            <SortHeader field="procore_ref" label="Procore Ref" />
            <SortHeader field="procore_value" label="Procore $" className="text-right" />
            <th className="table-header px-3 py-2 text-right whitespace-nowrap">Retainage</th>
            <SortHeader field="qb_ref" label="QB Ref" />
            <SortHeader field="qb_value" label="QB $" className="text-right" />
            <SortHeader field="variance" label="Variance" className="text-right" />
            <SortHeader field="severity" label="Match" />
            <SortHeader field="notes" label="Notes" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {sortedResults.map((result, idx) => (
            <tr
              key={result.id || idx}
              className="hover:bg-yellow-50 cursor-pointer"
              onClick={() => setSelectedResult(result)}
            >
              <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">
                {result.vendor || '-'}
              </td>
              <td className="px-3 py-2 text-procore-blue underline max-w-xs truncate" title={result.item_description}>
                {result.item_description || '-'}
              </td>
              <td className="px-3 py-2 text-gray-500">
                {result.status || '-'}
              </td>
              <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                {result.procore_ref || '-'}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {result.procore_value ? formatCurrency(result.procore_value) : '-'}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap text-orange-600">
                {result.procore_retainage ? formatCurrency(result.procore_retainage) : '-'}
              </td>
              <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                {result.qb_ref || '-'}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {result.qb_value ? formatCurrency(result.qb_value) : '-'}
              </td>
              <td className={`px-3 py-2 text-right font-medium whitespace-nowrap ${
                result.variance > 0 ? 'text-red-600' : result.variance < 0 ? 'text-green-600' : 'text-gray-500'
              }`}>
                {result.variance != null ? formatCurrency(result.variance) : '-'}
              </td>
              <td className="px-3 py-2">
                <span className={`badge text-xs ${getSeverityColor(result.severity)}`}>
                  {getSeverityText(result.severity)}
                </span>
              </td>
              <td className="px-3 py-2 text-gray-500 max-w-xs truncate" title={result.notes}>
                {result.notes || '-'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-100 font-semibold">
          <tr>
            <td className="px-3 py-2" colSpan={4}>TOTALS</td>
            <td className="px-3 py-2 text-right whitespace-nowrap">
              {formatCurrency(sortedResults.reduce((sum, r) => sum + (r.procore_value || 0), 0))}
            </td>
            <td className="px-3 py-2 text-right whitespace-nowrap text-orange-600">
              {formatCurrency(sortedResults.reduce((sum, r) => sum + (r.procore_retainage || 0), 0))}
            </td>
            <td className="px-3 py-2"></td>
            <td className="px-3 py-2 text-right whitespace-nowrap">
              {formatCurrency(sortedResults.reduce((sum, r) => sum + (r.qb_value || 0), 0))}
            </td>
            <td className={`px-3 py-2 text-right whitespace-nowrap ${
              sortedResults.reduce((sum, r) => sum + (r.variance || 0), 0) > 0 ? 'text-red-600' :
              sortedResults.reduce((sum, r) => sum + (r.variance || 0), 0) < 0 ? 'text-green-600' : ''
            }`}>
              {formatCurrency(sortedResults.reduce((sum, r) => sum + (r.variance || 0), 0))}
            </td>
            <td className="px-3 py-2" colSpan={2}></td>
          </tr>
        </tfoot>
      </table>
      <p className="text-xs text-gray-400 mt-2">Showing {sortedResults.length} results</p>
      {selectedResult && (
        <InvoiceDetailModal result={selectedResult} onClose={() => setSelectedResult(null)} />
      )}
    </div>
  )
}

// Vendor group interface for Phase 5
interface VendorGroup {
  vendor: string;
  procoreTotal: number;
  qbTotal: number;
  variance: number;
  retainageTotal: number; // Phase 6: Total retainage for vendor
  status: 'Reconciled' | 'Conditionally Reconciled' | 'Unreconciled';
  invoices: any[];
}

function GroupedResultsTable({ results, title }: { results: any[]; title?: string }) {
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set())
  const [expandAll, setExpandAll] = useState(false)
  const [selectedResult, setSelectedResult] = useState<any>(null)

  if (results.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No {title?.toLowerCase() || 'results'} in this category</p>
      </div>
    )
  }

  // Group results by vendor
  const vendorGroups: VendorGroup[] = []
  const vendorMap = new Map<string, any[]>()

  for (const result of results) {
    const vendor = result.vendor || 'Unknown Vendor'
    if (!vendorMap.has(vendor)) {
      vendorMap.set(vendor, [])
    }
    vendorMap.get(vendor)!.push(result)
  }

  for (const [vendor, invoices] of vendorMap) {
    const procoreTotal = invoices.reduce((sum, r) => sum + (r.procore_value || 0), 0)
    const qbTotal = invoices.reduce((sum, r) => sum + (r.qb_value || 0), 0)
    const variance = procoreTotal - qbTotal
    const retainageTotal = invoices.reduce((sum, r) => sum + (r.procore_retainage || 0), 0)

    // Determine status:
    // - Reconciled: All individual invoices match exactly (all have severity "info")
    // - Conditionally Reconciled: Individual invoices differ but totals match (variance ~= 0)
    // - Unreconciled: Totals don't match
    const allMatched = invoices.every(r => r.severity === 'info')
    const totalsMatch = Math.abs(variance) < 1 // Allow $1 tolerance for rounding

    let status: 'Reconciled' | 'Conditionally Reconciled' | 'Unreconciled'
    if (allMatched) {
      status = 'Reconciled'
    } else if (totalsMatch) {
      status = 'Conditionally Reconciled'
    } else {
      status = 'Unreconciled'
    }

    vendorGroups.push({
      vendor,
      procoreTotal,
      qbTotal,
      variance,
      retainageTotal,
      status,
      invoices,
    })
  }

  // Sort by vendor name
  vendorGroups.sort((a, b) => a.vendor.localeCompare(b.vendor))

  const toggleVendor = (vendor: string) => {
    const newExpanded = new Set(expandedVendors)
    if (newExpanded.has(vendor)) {
      newExpanded.delete(vendor)
    } else {
      newExpanded.add(vendor)
    }
    setExpandedVendors(newExpanded)
  }

  const toggleExpandAll = () => {
    if (expandAll) {
      setExpandedVendors(new Set())
    } else {
      setExpandedVendors(new Set(vendorGroups.map(g => g.vendor)))
    }
    setExpandAll(!expandAll)
  }

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'Reconciled':
        return 'text-green-700 bg-green-100'
      case 'Conditionally Reconciled':
        return 'text-yellow-700 bg-yellow-100'
      case 'Unreconciled':
        return 'text-red-700 bg-red-100'
      default:
        return 'text-gray-600 bg-gray-100'
    }
  }

  // Calculate grand totals
  const grandProcoreTotal = vendorGroups.reduce((sum, g) => sum + g.procoreTotal, 0)
  const grandQbTotal = vendorGroups.reduce((sum, g) => sum + g.qbTotal, 0)
  const grandVariance = grandProcoreTotal - grandQbTotal
  const grandRetainageTotal = vendorGroups.reduce((sum, g) => sum + g.retainageTotal, 0)

  return (
    <div className="overflow-x-auto">
      {title && <h3 className="text-lg font-medium mb-4">{title}</h3>}
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-gray-600">
          {vendorGroups.length} vendors, {results.length} total invoices
        </p>
        <button
          onClick={toggleExpandAll}
          className="text-sm text-procore-blue hover:underline flex items-center gap-1"
        >
          {expandAll ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      <table className="min-w-full divide-y divide-gray-200 text-xs">
        <thead className="bg-gray-50">
          <tr>
            <th className="table-header px-3 py-2 text-left w-8"></th>
            <th className="table-header px-3 py-2 text-left">Vendor</th>
            <th className="table-header px-3 py-2 text-right">Procore Total</th>
            <th className="table-header px-3 py-2 text-right">Retainage</th>
            <th className="table-header px-3 py-2 text-right">QB Total</th>
            <th className="table-header px-3 py-2 text-right">Variance</th>
            <th className="table-header px-3 py-2 text-center">Status</th>
            <th className="table-header px-3 py-2 text-center">Invoices</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {vendorGroups.map((group) => (
            <>
              {/* Vendor Header Row */}
              <tr
                key={group.vendor}
                className="bg-gray-50 hover:bg-gray-100 cursor-pointer"
                onClick={() => toggleVendor(group.vendor)}
              >
                <td className="px-3 py-2">
                  {expandedVendors.has(group.vendor) ? (
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-500" />
                  )}
                </td>
                <td className="px-3 py-2 font-semibold text-gray-900">
                  {group.vendor}
                </td>
                <td className="px-3 py-2 text-right font-medium">
                  {formatCurrency(group.procoreTotal)}
                </td>
                <td className="px-3 py-2 text-right font-medium text-orange-600">
                  {group.retainageTotal > 0 ? formatCurrency(group.retainageTotal) : '-'}
                </td>
                <td className="px-3 py-2 text-right font-medium">
                  {formatCurrency(group.qbTotal)}
                </td>
                <td className={`px-3 py-2 text-right font-medium ${
                  group.variance > 0.01 ? 'text-red-600' : group.variance < -0.01 ? 'text-green-600' : 'text-gray-500'
                }`}>
                  {formatCurrency(group.variance)}
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={`badge text-xs ${getStatusStyle(group.status)}`}>
                    {group.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-center text-gray-500">
                  {group.invoices.length}
                </td>
              </tr>
              {/* Invoice Detail Rows */}
              {expandedVendors.has(group.vendor) && group.invoices.map((inv, idx) => (
                <tr
                  key={`${group.vendor}-${idx}`}
                  className="bg-white hover:bg-yellow-50 cursor-pointer"
                  onClick={() => setSelectedResult(inv)}
                >
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2 pl-8 text-procore-blue underline">
                    {inv.item_description || inv.procore_ref || '-'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {inv.procore_value ? formatCurrency(inv.procore_value) : '-'}
                  </td>
                  <td className="px-3 py-2 text-right text-orange-600">
                    {inv.procore_retainage ? formatCurrency(inv.procore_retainage) : '-'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {inv.qb_value ? formatCurrency(inv.qb_value) : '-'}
                  </td>
                  <td className={`px-3 py-2 text-right ${
                    (inv.variance || 0) > 0 ? 'text-red-600' : (inv.variance || 0) < 0 ? 'text-green-600' : 'text-gray-500'
                  }`}>
                    {inv.variance != null ? formatCurrency(inv.variance) : '-'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`badge text-xs ${getSeverityColor(inv.severity)}`}>
                      {getSeverityText(inv.severity)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center text-gray-400 text-xs">
                    {inv.procore_ref || '-'}
                  </td>
                </tr>
              ))}
            </>
          ))}
        </tbody>
        <tfoot className="bg-gray-100 font-semibold">
          <tr>
            <td className="px-3 py-2"></td>
            <td className="px-3 py-2">GRAND TOTAL</td>
            <td className="px-3 py-2 text-right">{formatCurrency(grandProcoreTotal)}</td>
            <td className="px-3 py-2 text-right text-orange-600">{grandRetainageTotal > 0 ? formatCurrency(grandRetainageTotal) : '-'}</td>
            <td className="px-3 py-2 text-right">{formatCurrency(grandQbTotal)}</td>
            <td className={`px-3 py-2 text-right ${
              grandVariance > 0.01 ? 'text-red-600' : grandVariance < -0.01 ? 'text-green-600' : ''
            }`}>
              {formatCurrency(grandVariance)}
            </td>
            <td className="px-3 py-2" colSpan={2}></td>
          </tr>
        </tfoot>
      </table>
      {selectedResult && (
        <InvoiceDetailModal result={selectedResult} onClose={() => setSelectedResult(null)} />
      )}
    </div>
  )
}

function WarningsTable({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) {
    return (
      <div className="text-center py-8">
        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
        <p className="text-gray-500">No warnings found</p>
        <p className="text-sm text-gray-400 mt-1">All checks passed successfully</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">Reconciliation Warnings ({warnings.length})</h3>
      <div className="space-y-3">
        {warnings.map((warning) => (
          <div
            key={warning.id}
            className={`p-4 rounded-lg border ${
              warning.severity === 'critical'
                ? 'bg-red-50 border-red-200'
                : 'bg-yellow-50 border-yellow-200'
            }`}
          >
            <div className="flex items-start">
              {warning.severity === 'critical' ? (
                <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 mr-3 flex-shrink-0" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5 mr-3 flex-shrink-0" />
              )}
              <div className="flex-1">
                <p className={`font-medium ${
                  warning.severity === 'critical' ? 'text-red-800' : 'text-yellow-800'
                }`}>
                  {warning.message}
                </p>
                {warning.details && (
                  <p className={`text-sm mt-1 ${
                    warning.severity === 'critical' ? 'text-red-700' : 'text-yellow-700'
                  }`}>
                    {warning.details}
                  </p>
                )}
                {warning.vendor && (
                  <p className={`text-sm mt-1 ${
                    warning.severity === 'critical' ? 'text-red-600' : 'text-yellow-600'
                  }`}>
                    Vendor: {warning.vendor}
                  </p>
                )}
              </div>
              <span className={`badge ${
                warning.severity === 'critical' ? 'badge-critical' : 'badge-warning'
              }`}>
                {warning.severity}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CloseoutItemsTable({ items }: { items: any[] }) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8">
        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
        <p className="text-gray-500">No open closeout items</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr>
            <th className="table-header px-4 py-3">Priority</th>
            <th className="table-header px-4 py-3">Category</th>
            <th className="table-header px-4 py-3">Description</th>
            <th className="table-header px-4 py-3">Vendor</th>
            <th className="table-header px-4 py-3 text-right">Amount at Risk</th>
            <th className="table-header px-4 py-3">Action Required</th>
            <th className="table-header px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <span className={`badge ${getPriorityColor(item.priority)}`}>
                  {getPriorityLabel(item.priority)}
                </span>
              </td>
              <td className="px-4 py-3 text-sm">
                {item.category.replace(/_/g, ' ')}
              </td>
              <td className="px-4 py-3 text-sm">
                {item.description}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">
                {item.vendor || '-'}
              </td>
              <td className="px-4 py-3 text-sm text-right font-medium text-red-600">
                {formatCurrency(item.amount_at_risk)}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">
                {item.action_required || '-'}
              </td>
              <td className="px-4 py-3">
                <span className={`badge ${getStatusColor(item.status)}`}>
                  {item.status.replace(/_/g, ' ')}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FinancialTails({
  results,
  commitments,
  aiAnalysis,
  expandedTail,
  onToggle,
}: {
  results: any[]
  commitments: any[]
  aiAnalysis?: any
  expandedTail: 'open_aps' | 'open_ars' | 'pending_invoices' | null
  onToggle: (type: 'open_aps' | 'open_ars' | 'pending_invoices') => void
}) {
  // Open APs: use backend-computed QB bills with outstanding balance when available,
  // since the backend has direct access to QB bill balances. Fall back to client-side
  // cross-reference only when ai_analysis is missing.
  let openApItems: any[]
  let unpaidApAmount: number
  if (aiAnalysis?.open_ap_items && aiAnalysis.open_ap_items.length > 0) {
    openApItems = aiAnalysis.open_ap_items
    unpaidApAmount = aiAnalysis.open_ap_amount || 0
  } else if (aiAnalysis && aiAnalysis.open_ap_count === 0) {
    // Backend explicitly computed 0 open APs
    openApItems = []
    unpaidApAmount = 0
  } else {
    // Fallback: cross-reference invoice results with commitments
    const matchedInvoices = results.filter((r: any) => r.item_type === 'invoice' && r.qb_ref)
    openApItems = matchedInvoices.filter((r: any) => {
      const commitment = commitments.find((c: any) =>
        c.vendor && r.vendor &&
        c.vendor.toLowerCase().trim() === r.vendor.toLowerCase().trim()
      )
      if (!commitment) return true
      return (commitment.paid_to_date || 0) < (commitment.billed_to_date || 0) - 0.01
    })
    unpaidApAmount = openApItems.reduce((sum: number, r: any) => {
      const commitment = commitments.find((c: any) =>
        c.vendor && r.vendor &&
        c.vendor.toLowerCase().trim() === r.vendor.toLowerCase().trim()
      )
      if (!commitment) return sum + (r.qb_value || r.procore_value || 0)
      return sum + ((commitment.billed_to_date || 0) - (commitment.paid_to_date || 0))
    }, 0)
  }

  const openArItems = results.filter((r: any) => r.item_type === 'payment_app' && r.severity !== 'info')
  const pendingItems = commitments.filter((c: any) =>
    (c.retention_held || 0) > 0 ||
    (c.current_value || 0) > (c.billed_to_date || 0) + 0.01
  )

  if (openApItems.length === 0 && openArItems.length === 0 && pendingItems.length === 0) {
    return null
  }

  return (
    <div className="border-t pt-6">
      <h3 className="text-sm font-medium text-gray-700 mb-4">Financial Tails</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Open APs Card */}
        <button
          onClick={() => onToggle('open_aps')}
          className={`rounded-lg p-4 text-left transition-all ${
            expandedTail === 'open_aps'
              ? 'bg-orange-100 border-2 border-orange-400 shadow-md'
              : 'bg-orange-50 border-2 border-transparent hover:border-orange-300 hover:shadow'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <DollarSign className="w-5 h-5 text-orange-500 mr-2" />
              <span className="text-sm font-medium text-orange-800">Open APs</span>
            </div>
            {expandedTail === 'open_aps' ? (
              <ChevronDown className="w-4 h-4 text-orange-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-orange-400" />
            )}
          </div>
          <p className="text-2xl font-semibold text-orange-600 mt-1">{openApItems.length}</p>
          {unpaidApAmount > 0 && (
            <p className="text-xs text-orange-500 mt-1">{formatCurrency(unpaidApAmount)} outstanding</p>
          )}
        </button>

        {/* Open ARs Card */}
        <button
          onClick={() => onToggle('open_ars')}
          className={`rounded-lg p-4 text-left transition-all ${
            expandedTail === 'open_ars'
              ? 'bg-blue-100 border-2 border-blue-400 shadow-md'
              : 'bg-blue-50 border-2 border-transparent hover:border-blue-300 hover:shadow'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <DollarSign className="w-5 h-5 text-blue-500 mr-2" />
              <span className="text-sm font-medium text-blue-800">Open ARs</span>
            </div>
            {expandedTail === 'open_ars' ? (
              <ChevronDown className="w-4 h-4 text-blue-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-blue-400" />
            )}
          </div>
          <p className="text-2xl font-semibold text-blue-600 mt-1">{openArItems.length}</p>
        </button>

        {/* Pending Invoices Card */}
        <button
          onClick={() => onToggle('pending_invoices')}
          className={`rounded-lg p-4 text-left transition-all ${
            expandedTail === 'pending_invoices'
              ? 'bg-purple-100 border-2 border-purple-400 shadow-md'
              : 'bg-purple-50 border-2 border-transparent hover:border-purple-300 hover:shadow'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <FileText className="w-5 h-5 text-purple-500 mr-2" />
              <span className="text-sm font-medium text-purple-800">Pending Invoices</span>
            </div>
            {expandedTail === 'pending_invoices' ? (
              <ChevronDown className="w-4 h-4 text-purple-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-purple-400" />
            )}
          </div>
          <p className="text-2xl font-semibold text-purple-600 mt-1">{pendingItems.length}</p>
          {pendingItems.length > 0 && (
            <p className="text-xs text-purple-500 mt-1">
              {formatCurrency(pendingItems.reduce((sum: number, c: any) => sum + (c.retention_held || 0), 0))} retainage
            </p>
          )}
        </button>
      </div>

      {/* Expanded Detail Panels */}
      {expandedTail === 'open_aps' && openApItems.length > 0 && (
        <div className="mt-4 border border-orange-200 rounded-lg overflow-hidden">
          <div className="bg-orange-50 px-4 py-3">
            <h4 className="font-semibold text-orange-800">Open Accounts Payable</h4>
            <p className="text-xs text-orange-600">QB bills with outstanding balance for this project</p>
          </div>
          <div className="p-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-medium text-gray-500">Vendor</th>
                  <th className="text-left py-2 px-4 font-medium text-gray-500">QB Bill</th>
                  <th className="text-right py-2 px-4 font-medium text-gray-500">Bill Amt</th>
                  <th className="text-right py-2 pl-4 font-medium text-gray-500">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {openApItems.map((r: any, idx: number) => (
                  <tr key={r.id || r.bill_ref || idx} className="hover:bg-gray-50">
                    <td className="py-2 pr-4 text-gray-900 font-medium">{r.vendor || '-'}</td>
                    <td className="py-2 px-4 text-gray-600">{r.bill_ref || r.qb_ref || '-'}</td>
                    <td className="py-2 px-4 text-right">{formatCurrency(r.amount || r.qb_value || 0)}</td>
                    <td className="py-2 pl-4 text-right font-medium text-orange-600">{formatCurrency(r.balance || r.qb_value || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {expandedTail === 'open_aps' && openApItems.length === 0 && (
        <div className="mt-4 border border-orange-200 rounded-lg p-6 text-center">
          <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
          <p className="text-sm text-gray-600">All accounts payable are settled</p>
        </div>
      )}

      {expandedTail === 'open_ars' && openArItems.length > 0 && (
        <div className="mt-4 border border-blue-200 rounded-lg overflow-hidden">
          <div className="bg-blue-50 px-4 py-3">
            <h4 className="font-semibold text-blue-800">Open Accounts Receivable</h4>
            <p className="text-xs text-blue-600">Customer invoices with outstanding issues</p>
          </div>
          <div className="p-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-medium text-gray-500">Description</th>
                  <th className="text-left py-2 px-4 font-medium text-gray-500">QB Invoice</th>
                  <th className="text-right py-2 px-4 font-medium text-gray-500">Procore Amt</th>
                  <th className="text-right py-2 px-4 font-medium text-gray-500">QB Amt</th>
                  <th className="text-left py-2 pl-4 font-medium text-gray-500">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {openArItems.map((r: any) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="py-2 pr-4 text-gray-900 font-medium">{r.item_description || '-'}</td>
                    <td className="py-2 px-4 text-gray-600">{r.qb_ref || '-'}</td>
                    <td className="py-2 px-4 text-right">{r.procore_value != null ? formatCurrency(r.procore_value) : '-'}</td>
                    <td className="py-2 px-4 text-right">{r.qb_value != null ? formatCurrency(r.qb_value) : '-'}</td>
                    <td className="py-2 pl-4 text-gray-500 text-xs max-w-xs truncate" title={r.notes || ''}>{r.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {expandedTail === 'open_ars' && openArItems.length === 0 && (
        <div className="mt-4 border border-blue-200 rounded-lg p-6 text-center">
          <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
          <p className="text-sm text-gray-600">All accounts receivable are reconciled</p>
        </div>
      )}

      {expandedTail === 'pending_invoices' && pendingItems.length > 0 && (
        <div className="mt-4 border border-purple-200 rounded-lg overflow-hidden">
          <div className="bg-purple-50 px-4 py-3">
            <h4 className="font-semibold text-purple-800">Pending Invoices</h4>
            <p className="text-xs text-purple-600">Commitments with retainage held or unbilled amounts</p>
          </div>
          <div className="p-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-medium text-gray-500">Vendor</th>
                  <th className="text-right py-2 px-4 font-medium text-gray-500">Contract Value</th>
                  <th className="text-right py-2 px-4 font-medium text-gray-500">Billed to Date</th>
                  <th className="text-right py-2 px-4 font-medium text-gray-500">Retainage Held</th>
                  <th className="text-right py-2 pl-4 font-medium text-gray-500">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pendingItems.map((c: any) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="py-2 pr-4 text-gray-900 font-medium">{c.vendor}</td>
                    <td className="py-2 px-4 text-right">{formatCurrency(c.current_value)}</td>
                    <td className="py-2 px-4 text-right">{formatCurrency(c.billed_to_date)}</td>
                    <td className="py-2 px-4 text-right text-orange-600">{formatCurrency(c.retention_held)}</td>
                    <td className="py-2 pl-4 text-right font-medium text-purple-600">
                      {formatCurrency((c.current_value || 0) - (c.billed_to_date || 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {expandedTail === 'pending_invoices' && pendingItems.length === 0 && (
        <div className="mt-4 border border-purple-200 rounded-lg p-6 text-center">
          <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
          <p className="text-sm text-gray-600">All commitments fully billed with no retainage outstanding</p>
        </div>
      )}
    </div>
  )
}
