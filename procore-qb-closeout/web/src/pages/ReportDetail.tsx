import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, Fragment } from 'react'
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
  XCircle,
  MinusCircle,
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

type TabType = 'summary' | 'sub_invoices' | 'sub_payments' | 'owner_invoices' | 'owner_payments' | 'direct_costs' | 'labor' | 'unbilled_commitments' | 'warnings' | 'closeout'

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
  const [billingPeriod, setBillingPeriod] = useState<string>('all') // 'all' or 'YYYY-MM'

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
  // all_bill_details includes fully-paid bills too; fall back to open_ap_items for older reports
  const allBillDetails: any[] = aiAnalysis?.all_bill_details || openApItems
  const subInvoiceResults = subInvoiceResultsRaw.length > 0
    ? subInvoiceResultsRaw.map((r: any) => {
        // Enrich reconciliation results with bill detail data for the modal.
        // Use normalized vendor name comparison (strips LLC/Inc/Corp) to handle
        // Procore vs QB vendor name differences and prevent cross-vendor contamination.
        const vendorNorm = normalizeVendorForMatch(r.vendor)
        const vendorBills = allBillDetails.filter((ap: any) =>
          normalizeVendorForMatch(ap.vendor) === vendorNorm
        )
        const apMatch =
          vendorBills.find((ap: any) => {
            if (!ap.bill_ref || !r.qb_ref) return false
            const ref = String(ap.bill_ref)
            // Match "Bill 123" to bill_ref "123" — extract trailing number from qb_ref
            const qbRefNum = r.qb_ref.replace(/^.*?#?\s*/, '')
            return ref === qbRefNum || ref === r.qb_ref
          }) ||
          vendorBills.find((ap: any) =>
            r.qb_value != null && ap.amount != null &&
            Math.abs(ap.amount - r.qb_value) < 0.01
          ) ||
          vendorBills[0] || null
        if (!apMatch) return r
        const paid = apMatch.paid ?? (apMatch.amount != null && apMatch.balance != null ? apMatch.amount - apMatch.balance : null)
        return {
          ...r,
          _ap_detail: {
            balance: apMatch.balance,
            paid: paid,
            date: apMatch.date,
            due_date: apMatch.due_date,
            memo: apMatch.memo,
            contract_value: apMatch.contract_value,
            billed_to_date: apMatch.billed_to_date,
            paid_to_date: apMatch.paid_to_date,
            retention_held: apMatch.retention_held,
            commitment_type: apMatch.commitment_type,
            commitment_status: apMatch.commitment_status,
            commitment_title: apMatch.commitment_title,
          },
        }
      })
    : openApItems.map((item: any, idx: number) => {
        const paid = item.paid ?? (item.amount != null && item.balance != null ? item.amount - item.balance : null)
        const pctPaid = item.amount ? ((paid ?? 0) / item.amount * 100) : 0
        return {
          id: `ap-${idx}`,
          report_id: report.id,
          result_id: `ap-${idx}`,
          item_type: 'invoice',
          item_description: `QB Bill #${item.bill_ref || 'N/A'}`,
          vendor: item.vendor || null,
          procore_value: item.amount ?? null,
          qb_value: item.amount ?? null,
          variance: 0,
          variance_pct: 0,
          severity: 'info' as const,
          notes: item.balance > 0
            ? `Outstanding balance: ${formatCurrency(item.balance)} of ${formatCurrency(item.amount)} (${pctPaid.toFixed(0)}% paid)`
            : 'Paid in full',
          procore_ref: item.commitment_title || null,
          qb_ref: item.bill_ref ? `Bill #${item.bill_ref}` : null,
          qb_date: item.date || null,
          procore_date: item.due_date ? `Due: ${item.due_date}` : null,
          requires_action: item.balance > 0,
          created_at: '',
          // Pass through all the rich data for InvoiceDetailModal
          _ap_detail: {
            balance: item.balance,
            paid: paid,
            date: item.date,
            due_date: item.due_date,
            memo: item.memo,
            contract_value: item.contract_value,
            billed_to_date: item.billed_to_date,
            paid_to_date: item.paid_to_date,
            retention_held: item.retention_held,
            commitment_type: item.commitment_type,
            commitment_status: item.commitment_status,
            commitment_title: item.commitment_title,
          },
        }
      })

  // Generate warnings based on the data
  const warnings = generateWarnings(results || [], commitments || [], report)

  // Unbilled commitments: subcontracts/POs with contract value but zero billing
  const unbilledCommitments = (commitments || []).filter((c: any) =>
    c.current_value > 0 && (!c.billed_to_date || c.billed_to_date <= 0)
  )

  // Compute available billing periods from results
  const billingPeriods = (() => {
    const periods = new Set<string>()
    for (const r of (results || [])) {
      const date = r.billing_date || r.procore_date || r.qb_date
      if (date) {
        const d = new Date(date)
        if (!isNaN(d.getTime())) {
          periods.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
        }
      }
    }
    return Array.from(periods).sort().reverse()
  })()

  // Filter results by billing period
  const filterByPeriod = (items: any[]) => {
    if (billingPeriod === 'all') return items
    return items.filter(r => {
      const date = r.billing_date || r.procore_date || r.qb_date
      if (!date) return true // Include items without dates
      const d = new Date(date)
      if (isNaN(d.getTime())) return true
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      return period <= billingPeriod
    })
  }

  const filteredSubInvoices = filterByPeriod(subInvoiceResults)
  const filteredOwnerInvoices = filterByPeriod(ownerInvoiceResults)
  const filteredDirectCosts = filterByPeriod(directCostResults)
  const filteredLabor = filterByPeriod(laborResults)
  const filteredResults = filterByPeriod(results || [])

  const tabs = [
    { id: 'summary' as TabType, label: 'Summary', count: null },
    { id: 'sub_invoices' as TabType, label: 'Sub Invoices', count: filteredSubInvoices.length },
    { id: 'sub_payments' as TabType, label: 'Sub Payments', count: null },
    { id: 'owner_invoices' as TabType, label: 'Owner Invoices', count: filteredOwnerInvoices.length },
    { id: 'owner_payments' as TabType, label: 'Owner Payments', count: null },
    { id: 'direct_costs' as TabType, label: 'Direct Costs', count: filteredDirectCosts.length },
    { id: 'labor' as TabType, label: 'Labor', count: filteredLabor.length },
    ...(unbilledCommitments.length > 0 ? [{ id: 'unbilled_commitments' as TabType, label: 'Unbilled Commitments', count: unbilledCommitments.length }] : []),
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
                {(() => {
                  const procoreRetReleased = report.procore_retainage_released ?? report.procore_retention_paid ?? 0
                  const qboRetReleased = report.qbo_retainage_released ?? report.qbo_retention_paid ?? 0
                  return (
                    <tr>
                      <td className="py-2 pr-4 text-gray-700">Retainage Released</td>
                      <td className="py-2 px-4 text-right font-medium">{formatCurrency(procoreRetReleased)}</td>
                      <td className="py-2 px-4 text-right font-medium">{formatCurrency(qboRetReleased)}</td>
                      <td className={`py-2 pl-4 text-right font-medium ${
                        procoreRetReleased - qboRetReleased !== 0 ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {formatCurrency(procoreRetReleased - qboRetReleased)}
                      </td>
                    </tr>
                  )
                })()}
                {(() => {
                  const procoreRetPaid = report.procore_retainage_paid ?? 0
                  const qboRetPaid = report.qbo_retainage_paid ?? 0
                  return (
                    <tr>
                      <td className="py-2 pr-4 text-gray-700">Retainage Paid</td>
                      <td className="py-2 px-4 text-right font-medium">{formatCurrency(procoreRetPaid)}</td>
                      <td className="py-2 px-4 text-right font-medium">{formatCurrency(qboRetPaid)}</td>
                      <td className={`py-2 pl-4 text-right font-medium ${
                        procoreRetPaid - qboRetPaid !== 0 ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {formatCurrency(procoreRetPaid - qboRetPaid)}
                      </td>
                    </tr>
                  )
                })()}
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

      {/* Billing Period Filter */}
      {billingPeriods.length > 0 && (
        <div className="card p-3 flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Billing Period:</label>
          <select
            value={billingPeriod}
            onChange={(e) => setBillingPeriod(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-procore-blue focus:border-procore-blue"
          >
            <option value="all">All Periods</option>
            {billingPeriods.map(p => {
              const [y, m] = p.split('-')
              const label = new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
              return <option key={p} value={p}>{label}</option>
            })}
          </select>
          {billingPeriod !== 'all' && (
            <button
              onClick={() => setBillingPeriod('all')}
              className="text-xs text-procore-blue hover:underline"
            >
              Clear
            </button>
          )}
          {billingPeriod !== 'all' && (
            <span className="text-xs text-gray-500">
              Showing data through {new Date(parseInt(billingPeriod.split('-')[0]), parseInt(billingPeriod.split('-')[1]) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </span>
          )}
        </div>
      )}

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
            commitments={commitments || []}
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
              <GroupedResultsTable results={filteredSubInvoices} title="Subcontractor Invoices" commitments={commitments || []} />
            )}

            {activeTab === 'sub_payments' && (
              <SubPaymentsTable report={report} commitments={commitments || []} results={filteredResults} billingPeriod={billingPeriod} />
            )}

            {activeTab === 'owner_invoices' && (
              <OwnerInvoicesTable results={filteredOwnerInvoices} title="Owner Invoices" />
            )}

            {activeTab === 'owner_payments' && (
              <OwnerPaymentsTable report={report} results={filteredResults} billingPeriod={billingPeriod} />
            )}

            {activeTab === 'direct_costs' && (
              <ResultsTable results={filteredDirectCosts} title="Direct Costs" />
            )}

            {activeTab === 'labor' && (
              <ResultsTable results={filteredLabor} title="Labor Costs" />
            )}

            {activeTab === 'unbilled_commitments' && (
              <UnbilledCommitmentsTable commitments={unbilledCommitments} />
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

// Normalize vendor name for comparison: strip suffixes, lowercase, trim
function normalizeVendorForMatch(name: string | null | undefined): string {
  if (!name) return ''
  return name
    .replace(/,?\s*(LLC|Inc\.?|Corp\.?|Co\.?|Ltd\.?|L\.?L\.?C\.?|Incorporated|Corporation|Company)\s*$/i, '')
    .toLowerCase()
    .trim()
}

// Detail modal for viewing full Procore/QB data for a line item
function InvoiceDetailModal({ result, onClose, commitments = [] }: { result: any; onClose: () => void; commitments?: any[] }) {
  if (!result) return null

  const ap = result._ap_detail as {
    balance: number; paid: number; date: string; due_date: string; memo: string;
    contract_value: number; billed_to_date: number; paid_to_date: number;
    retention_held: number; commitment_type: string; commitment_status: string;
    commitment_title: string;
  } | undefined

  // Look up commitment directly by vendor name for reliable Subcontract Summary data.
  // This avoids cross-vendor contamination from bill-level enrichment.
  const vendorNorm = normalizeVendorForMatch(result.vendor)
  const commitment = commitments.find((c: any) =>
    normalizeVendorForMatch(c.vendor) === vendorNorm
  )

  // Sanity check: if ap.paid is wildly larger than the bill amount (>200%), the bill
  // enrichment likely matched the wrong bill. Fall back to null to avoid showing bad data.
  const rawPctPaid = ap && result.qb_value ? ((ap.paid ?? 0) / result.qb_value * 100) : null
  const pctPaid = rawPctPaid != null && rawPctPaid > 200 ? null : rawPctPaid

  // Build a status explanation
  let statusExplanation = ''
  if (ap) {
    if (ap.balance <= 0) {
      statusExplanation = 'This bill has been fully paid in QuickBooks. No further action needed.'
    } else if (pctPaid != null && pctPaid > 0) {
      statusExplanation = `This bill has been partially paid (${pctPaid.toFixed(0)}%). ${formatCurrency(ap.balance)} remains outstanding.`
    } else {
      statusExplanation = `This bill is unpaid. The full amount of ${formatCurrency(ap.balance)} is outstanding.`
    }
    const retHeld = commitment?.retention_held ?? ap.retention_held
    if (retHeld != null && retHeld > 0) {
      statusExplanation += ` Retainage of ${formatCurrency(retHeld)} is currently held on this subcontract.`
    }
    if (ap.due_date) {
      const due = new Date(ap.due_date)
      const now = new Date()
      if (due < now && ap.balance > 0) {
        statusExplanation += ' This bill is past due.'
      }
    }
  } else if (result.notes) {
    statusExplanation = result.notes
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" onClick={onClose}>
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="fixed inset-0 bg-black/50" />
        <div
          className="relative bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between rounded-t-xl z-10">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                {result.vendor || result.item_description || 'Line Item Detail'}
              </h3>
              <p className="text-sm text-gray-500 mt-0.5">
                {result.qb_ref || result.item_description || ''}
                {(commitment?.title || ap?.commitment_title) ? ` — ${commitment?.title || ap?.commitment_title}` : ''}
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`badge text-xs ${getSeverityColor(result.severity)}`}>
                  {getSeverityText(result.severity)}
                </span>
                {result.status && (
                  <span className={`badge text-xs ${getStatusColor(result.status)}`}>
                    {result.status?.replace(/_/g, ' ')}
                  </span>
                )}
                {(commitment?.commitment_type || ap?.commitment_type) && (
                  <span className="badge text-xs bg-gray-100 text-gray-600">
                    {(commitment?.commitment_type || ap?.commitment_type) === 'subcontract' ? 'Subcontract' : 'Purchase Order'}
                  </span>
                )}
                {(commitment?.status || ap?.commitment_status) && (
                  <span className="badge text-xs bg-gray-100 text-gray-600">
                    {commitment?.status || ap?.commitment_status}
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <div className="p-6 space-y-5">
            {/* Status Explanation Banner */}
            {statusExplanation && (
              <div className={`rounded-lg p-4 text-sm ${
                ap && ap.balance <= 0
                  ? 'bg-green-50 border border-green-200 text-green-800'
                  : ap && ap.balance > 0
                  ? 'bg-orange-50 border border-orange-200 text-orange-800'
                  : 'bg-blue-50 border border-blue-200 text-blue-800'
              }`}>
                {statusExplanation}
              </div>
            )}

            {/* Payment Progress (for AP items with balance data) */}
            {ap && result.qb_value != null && (
              <div className="bg-gray-50 border rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Payment Status</h4>
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Paid: {formatCurrency(ap.paid ?? 0)}</span>
                    <span>Total: {formatCurrency(result.qb_value)}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className={`h-3 rounded-full transition-all ${
                        (pctPaid ?? 0) >= 100 ? 'bg-green-500' : (pctPaid ?? 0) > 0 ? 'bg-blue-500' : 'bg-gray-300'
                      }`}
                      style={{ width: `${Math.min(pctPaid ?? 0, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-gray-500">{(pctPaid ?? 0).toFixed(0)}% paid</span>
                    {ap.balance > 0 && (
                      <span className="font-medium text-orange-600">
                        {formatCurrency(ap.balance)} outstanding
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm border-t pt-3">
                  <div>
                    <dt className="text-gray-500 text-xs">Bill Amount</dt>
                    <dd className="font-semibold text-gray-900">{formatCurrency(result.qb_value)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 text-xs">Paid</dt>
                    <dd className="font-semibold text-green-600">{formatCurrency(ap.paid ?? 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 text-xs">Outstanding</dt>
                    <dd className="font-semibold text-orange-600">{formatCurrency(ap.balance)}</dd>
                  </div>
                </div>
              </div>
            )}

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
                      <dt className="text-blue-600">Retainage Held</dt>
                      <dd className="font-medium text-orange-600">{formatCurrency(result.procore_retainage)}</dd>
                    </div>
                  )}
                  {result.retainage_released != null && result.retainage_released > 0 && (
                    <div>
                      <dt className="text-blue-600">Retention Released</dt>
                      <dd className="font-medium text-green-600">{formatCurrency(result.retainage_released)}</dd>
                    </div>
                  )}
                  {((commitment?.retention_held ?? ap?.retention_held) != null && (commitment?.retention_held ?? ap?.retention_held) > 0) && (
                    <div>
                      <dt className="text-blue-600">Retainage Held (Subcontract)</dt>
                      <dd className="font-medium text-orange-600">{formatCurrency(commitment?.retention_held ?? ap?.retention_held)}</dd>
                    </div>
                  )}
                  {result.billing_date && (
                    <div>
                      <dt className="text-blue-600">Billing Date</dt>
                      <dd className="font-medium text-gray-900">{result.billing_date}</dd>
                    </div>
                  )}
                  {result.procore_date && result.procore_date !== result.billing_date && (
                    <div>
                      <dt className="text-blue-600">Submitted Date</dt>
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
                    <dt className="text-green-600">Bill Amount</dt>
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
                  {result.retainage_released != null && result.retainage_released > 0 && (
                    <div>
                      <dt className="text-green-600">Retention Released</dt>
                      <dd className="font-medium text-green-600">{formatCurrency(result.retainage_released)}</dd>
                    </div>
                  )}
                  {ap?.date && (
                    <div>
                      <dt className="text-green-600">Bill Date</dt>
                      <dd className="font-medium text-gray-900">{ap.date}</dd>
                    </div>
                  )}
                  {ap?.due_date && (
                    <div>
                      <dt className="text-green-600">Due Date</dt>
                      <dd className={`font-medium ${
                        new Date(ap.due_date) < new Date() && ap.balance > 0 ? 'text-red-600' : 'text-gray-900'
                      }`}>
                        {ap.due_date}
                        {new Date(ap.due_date) < new Date() && ap.balance > 0 && ' (Past Due)'}
                      </dd>
                    </div>
                  )}
                  {!ap?.date && result.qb_date && (
                    <div>
                      <dt className="text-green-600">Date</dt>
                      <dd className="font-medium text-gray-900">{result.qb_date}</dd>
                    </div>
                  )}
                  {ap?.memo && (
                    <div>
                      <dt className="text-green-600">Memo</dt>
                      <dd className="font-medium text-gray-700 text-xs">{ap.memo}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>

            {/* Billing Breakdown (AIA/G702 format) */}
            {(result.work_completed_this_period > 0 || result.work_completed_previous > 0 || result.materials_stored > 0 || result.total_completed_and_stored > 0) && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-purple-800 uppercase tracking-wide mb-3">
                  Billing Breakdown
                </h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  {result.work_completed_this_period > 0 && (
                    <div>
                      <dt className="text-purple-600 text-xs">Work Completed This Period</dt>
                      <dd className="font-semibold text-gray-900">{formatCurrency(result.work_completed_this_period)}</dd>
                    </div>
                  )}
                  {result.work_completed_previous > 0 && (
                    <div>
                      <dt className="text-purple-600 text-xs">Work Completed (Previous)</dt>
                      <dd className="font-semibold text-gray-900">{formatCurrency(result.work_completed_previous)}</dd>
                    </div>
                  )}
                  {result.materials_stored > 0 && (
                    <div>
                      <dt className="text-purple-600 text-xs">Materials Stored</dt>
                      <dd className="font-semibold text-gray-900">{formatCurrency(result.materials_stored)}</dd>
                    </div>
                  )}
                  {result.total_completed_and_stored > 0 && (
                    <div>
                      <dt className="text-purple-600 text-xs">Total Completed & Stored to Date</dt>
                      <dd className="font-semibold text-gray-900">{formatCurrency(result.total_completed_and_stored)}</dd>
                    </div>
                  )}
                  {result.procore_retainage > 0 && (
                    <div>
                      <dt className="text-purple-600 text-xs">Less Retainage</dt>
                      <dd className="font-semibold text-orange-600">({formatCurrency(result.procore_retainage)})</dd>
                    </div>
                  )}
                  {result.retainage_released > 0 && (
                    <div>
                      <dt className="text-purple-600 text-xs">Plus Retention Released</dt>
                      <dd className="font-semibold text-green-600">{formatCurrency(result.retainage_released)}</dd>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Commitment / Subcontract Details — sourced directly from commitments table */}
            {(() => {
              const cv = commitment?.current_value ?? ap?.contract_value
              const btd = commitment?.billed_to_date ?? ap?.billed_to_date
              const ptd = commitment?.paid_to_date ?? ap?.paid_to_date
              const rh = commitment?.retention_held ?? ap?.retention_held
              if (cv == null) return null
              return (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-indigo-800 uppercase tracking-wide mb-3">
                    Subcontract Summary
                  </h4>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <dt className="text-indigo-600 text-xs">Contract Value</dt>
                      <dd className="font-semibold text-gray-900">{formatCurrency(cv)}</dd>
                    </div>
                    <div>
                      <dt className="text-indigo-600 text-xs">Billed to Date</dt>
                      <dd className="font-semibold text-gray-900">{formatCurrency(btd ?? 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-indigo-600 text-xs">Paid to Date</dt>
                      <dd className="font-semibold text-gray-900">{formatCurrency(ptd ?? 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-indigo-600 text-xs">Retainage Held</dt>
                      <dd className="font-semibold text-orange-600">
                        {formatCurrency(rh ?? 0)}
                      </dd>
                    </div>
                    {cv > 0 && (
                      <>
                        <div>
                          <dt className="text-indigo-600 text-xs">Remaining to Bill</dt>
                          <dd className="font-semibold text-purple-600">
                            {formatCurrency(cv - (btd ?? 0))}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-indigo-600 text-xs">% Complete (Billed)</dt>
                          <dd className="font-semibold text-gray-900">
                            {((btd ?? 0) / cv * 100).toFixed(1)}%
                          </dd>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )
            })()}

            {/* Payment History — Procore and QuickBooks payments */}
            {ap && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-emerald-800 uppercase tracking-wide mb-3">
                  Payment Information
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {/* Procore Payments */}
                  <div>
                    <h5 className="text-xs font-semibold text-emerald-700 mb-2">Procore</h5>
                    <dl className="space-y-1">
                      {(commitment?.paid_to_date || ap?.paid_to_date) != null && (
                        <div className="flex justify-between">
                          <dt className="text-emerald-600 text-xs">Total Paid to Date</dt>
                          <dd className="font-medium text-gray-900 text-xs">{formatCurrency(commitment?.paid_to_date ?? ap?.paid_to_date ?? 0)}</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                  {/* QuickBooks Payments */}
                  <div>
                    <h5 className="text-xs font-semibold text-emerald-700 mb-2">QuickBooks</h5>
                    <dl className="space-y-1">
                      <div className="flex justify-between">
                        <dt className="text-emerald-600 text-xs">Bill Amount</dt>
                        <dd className="font-medium text-gray-900 text-xs">{formatCurrency(result.qb_value ?? 0)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-emerald-600 text-xs">Paid</dt>
                        <dd className="font-medium text-green-600 text-xs">{formatCurrency(ap.paid ?? 0)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-emerald-600 text-xs">Outstanding</dt>
                        <dd className="font-medium text-orange-600 text-xs">{formatCurrency(ap.balance ?? 0)}</dd>
                      </div>
                      {ap.date && (
                        <div className="flex justify-between">
                          <dt className="text-emerald-600 text-xs">Bill Date</dt>
                          <dd className="font-medium text-gray-900 text-xs">{ap.date}</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                </div>
              </div>
            )}

            {/* Variance (show when there's a real variance from matched results) */}
            {result.variance != null && Math.abs(result.variance) >= 1 && (
              <div className="bg-gray-50 border rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Variance</h4>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <dt className="text-gray-500">Amount</dt>
                    <dd className={`text-lg font-semibold ${
                      result.variance > 0 ? 'text-red-600' : result.variance < 0 ? 'text-green-600' : 'text-gray-500'
                    }`}>
                      {formatCurrency(result.variance)}
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
            )}

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
  procoreRetainageTotal: number;
  qbRetainageTotal: number;
  procoreRetReleasedTotal: number;
  qbRetReleasedTotal: number;
  committedCost: number | null; // Revised Contract Amount from commitments
  status: 'Reconciled' | 'Conditionally Reconciled' | 'Unreconciled';
  invoices: any[];
}

function GroupedResultsTable({ results, title, commitments = [] }: { results: any[]; title?: string; commitments?: any[] }) {
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
    const procoreRetainageTotal = invoices.reduce((sum, r) => sum + (r.procore_retainage || 0), 0)
    const qbRetainageTotal = invoices.reduce((sum, r) => sum + (r.qb_retainage || 0), 0)
    const procoreRetReleasedTotal = invoices.reduce((sum, r) => sum + (r.retainage_released || 0), 0)
    const qbRetReleasedTotal = 0 // QB doesn't track retainage releases separately

    // Look up committed cost (Revised Contract Amount) from commitments
    const matchingCommitment = commitments.find((c: any) =>
      c.vendor && vendor && c.vendor.toLowerCase() === vendor.toLowerCase()
    )
    const committedCost = matchingCommitment?.current_value ?? null

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
      procoreRetainageTotal,
      qbRetainageTotal,
      procoreRetReleasedTotal,
      qbRetReleasedTotal,
      committedCost,
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
  const grandProcoreRetainage = vendorGroups.reduce((sum, g) => sum + g.procoreRetainageTotal, 0)
  const grandQbRetainage = vendorGroups.reduce((sum, g) => sum + g.qbRetainageTotal, 0)
  const grandProcoreRetReleased = vendorGroups.reduce((sum, g) => sum + g.procoreRetReleasedTotal, 0)
  const grandQbRetReleased = vendorGroups.reduce((sum, g) => sum + g.qbRetReleasedTotal, 0)
  const grandCommittedCost = vendorGroups.reduce((sum, g) => sum + (g.committedCost || 0), 0)

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
            <th className="table-header px-3 py-2 text-right">Committed Costs</th>
            <th className="table-header px-3 py-2 text-right">Procore Total</th>
            <th className="table-header px-3 py-2 text-right text-orange-600">Procore Retainage</th>
            <th className="table-header px-3 py-2 text-right text-green-600">Procore Ret. Released</th>
            <th className="table-header px-3 py-2 text-right">QB Total</th>
            <th className="table-header px-3 py-2 text-right text-orange-600">QB Retainage</th>
            <th className="table-header px-3 py-2 text-right text-green-600">QB Ret. Released</th>
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
                <td className="px-3 py-2 text-right font-medium text-gray-500">
                  {group.committedCost != null ? (
                    <span className="inline-flex items-center gap-1 justify-end">
                      {formatCurrency(group.committedCost)}
                      {(() => {
                        const cc = group.committedCost!
                        const pt = group.procoreTotal
                        const qt = group.qbTotal
                        if (Math.abs(pt - cc) < 1 && Math.abs(qt - cc) < 1) {
                          return <CheckCircle className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                        } else if (pt > cc + 1 || qt > cc + 1) {
                          return <XCircle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />
                        } else {
                          return <MinusCircle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
                        }
                      })()}
                    </span>
                  ) : '-'}
                </td>
                <td className="px-3 py-2 text-right font-medium">
                  {formatCurrency(group.procoreTotal)}
                </td>
                <td className="px-3 py-2 text-right font-medium text-orange-600">
                  {group.procoreRetainageTotal > 0 ? formatCurrency(group.procoreRetainageTotal) : '-'}
                </td>
                <td className="px-3 py-2 text-right font-medium text-green-600">
                  {group.procoreRetReleasedTotal > 0 ? formatCurrency(group.procoreRetReleasedTotal) : '-'}
                </td>
                <td className="px-3 py-2 text-right font-medium">
                  {formatCurrency(group.qbTotal)}
                </td>
                <td className="px-3 py-2 text-right font-medium text-orange-600">
                  {group.qbRetainageTotal > 0 ? formatCurrency(group.qbRetainageTotal) : '-'}
                </td>
                <td className="px-3 py-2 text-right font-medium text-green-600">
                  {group.qbRetReleasedTotal > 0 ? formatCurrency(group.qbRetReleasedTotal) : '-'}
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
                  <td className="px-3 py-2 text-right text-gray-400">-</td>
                  <td className="px-3 py-2 text-right">
                    {inv.procore_value ? formatCurrency(inv.procore_value) : '-'}
                  </td>
                  <td className="px-3 py-2 text-right text-orange-600">
                    {inv.procore_retainage ? formatCurrency(inv.procore_retainage) : '-'}
                  </td>
                  <td className="px-3 py-2 text-right text-green-600">
                    {inv.retainage_released ? formatCurrency(inv.retainage_released) : '-'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {inv.qb_value ? formatCurrency(inv.qb_value) : '-'}
                  </td>
                  <td className="px-3 py-2 text-right text-orange-600">
                    {inv.qb_retainage ? formatCurrency(inv.qb_retainage) : '-'}
                  </td>
                  <td className="px-3 py-2 text-right text-green-600">-</td>
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
            <td className="px-3 py-2 text-right">{grandCommittedCost > 0 ? formatCurrency(grandCommittedCost) : '-'}</td>
            <td className="px-3 py-2 text-right">{formatCurrency(grandProcoreTotal)}</td>
            <td className="px-3 py-2 text-right text-orange-600">{grandProcoreRetainage > 0 ? formatCurrency(grandProcoreRetainage) : '-'}</td>
            <td className="px-3 py-2 text-right text-green-600">{grandProcoreRetReleased > 0 ? formatCurrency(grandProcoreRetReleased) : '-'}</td>
            <td className="px-3 py-2 text-right">{formatCurrency(grandQbTotal)}</td>
            <td className="px-3 py-2 text-right text-orange-600">{grandQbRetainage > 0 ? formatCurrency(grandQbRetainage) : '-'}</td>
            <td className="px-3 py-2 text-right text-green-600">{grandQbRetReleased > 0 ? formatCurrency(grandQbRetReleased) : '-'}</td>
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
        <InvoiceDetailModal result={selectedResult} onClose={() => setSelectedResult(null)} commitments={commitments} />
      )}
    </div>
  )
}

// Owner Invoices table with net amounts, split retainage columns, no Vendor/Description/Status
function OwnerInvoicesTable({ results, title }: { results: any[]; title?: string }) {
  const [selectedResult, setSelectedResult] = useState<any>(null)

  if (results.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No {title?.toLowerCase() || 'results'} in this category</p>
      </div>
    )
  }

  const sortedResults = [...results].sort((a, b) => {
    const aDate = a.procore_date || a.qb_date || ''
    const bDate = b.procore_date || b.qb_date || ''
    return aDate.localeCompare(bDate)
  })

  return (
    <div className="overflow-x-auto">
      {title && <h3 className="text-lg font-medium mb-4">{title}</h3>}
      <table className="min-w-full divide-y divide-gray-200 text-xs">
        <thead className="bg-gray-50">
          <tr>
            <th className="table-header px-3 py-2 text-left">Pay App #</th>
            <th className="table-header px-3 py-2 text-left">Procore Ref</th>
            <th className="table-header px-3 py-2 text-right">Procore $</th>
            <th className="table-header px-3 py-2 text-right text-orange-600">Procore Retainage</th>
            <th className="table-header px-3 py-2 text-left">QB Ref</th>
            <th className="table-header px-3 py-2 text-right">QB $</th>
            <th className="table-header px-3 py-2 text-right text-orange-600">QB Retainage</th>
            <th className="table-header px-3 py-2 text-right">Variance</th>
            <th className="table-header px-3 py-2 text-center">Match</th>
            <th className="table-header px-3 py-2 text-left">Notes</th>
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
                {result.item_description || '-'}
              </td>
              <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                {result.procore_ref || '-'}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {result.procore_value != null ? formatCurrency(result.procore_value) : '-'}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap text-orange-600">
                {(result.payment_app_retainage || 0) > 0 ? formatCurrency(result.payment_app_retainage) : '-'}
              </td>
              <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                {result.qb_ref || '-'}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {result.qb_value != null ? formatCurrency(result.qb_value) : '-'}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap text-orange-600">
                {/* QB retainage derived from difference between Procore gross and QB amount */}
                {(result.payment_app_retainage || 0) > 0 && result.qb_value != null
                  ? formatCurrency(result.payment_app_retainage)
                  : '-'}
              </td>
              <td className={`px-3 py-2 text-right font-medium whitespace-nowrap ${
                (result.variance || 0) > 0 ? 'text-red-600' : (result.variance || 0) < 0 ? 'text-green-600' : 'text-gray-500'
              }`}>
                {result.variance != null ? formatCurrency(result.variance) : '-'}
              </td>
              <td className="px-3 py-2 text-center">
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
            <td className="px-3 py-2" colSpan={2}>TOTALS</td>
            <td className="px-3 py-2 text-right whitespace-nowrap">
              {formatCurrency(sortedResults.reduce((sum, r) => sum + (r.procore_value || 0), 0))}
            </td>
            <td className="px-3 py-2 text-right whitespace-nowrap text-orange-600">
              {formatCurrency(sortedResults.reduce((sum, r) => sum + (r.payment_app_retainage || 0), 0))}
            </td>
            <td className="px-3 py-2"></td>
            <td className="px-3 py-2 text-right whitespace-nowrap">
              {formatCurrency(sortedResults.reduce((sum, r) => sum + (r.qb_value || 0), 0))}
            </td>
            <td className="px-3 py-2 text-right whitespace-nowrap text-orange-600">
              {formatCurrency(sortedResults.reduce((sum, r) => sum + (r.payment_app_retainage || 0), 0))}
            </td>
            <td className={`px-3 py-2 text-right whitespace-nowrap ${
              sortedResults.reduce((sum, r) => sum + (r.variance || 0), 0) !== 0 ? 'text-red-600' : ''
            }`}>
              {formatCurrency(sortedResults.reduce((sum, r) => sum + (r.variance || 0), 0))}
            </td>
            <td className="px-3 py-2" colSpan={2}></td>
          </tr>
        </tfoot>
      </table>
      <p className="text-xs text-gray-400 mt-2">Showing {sortedResults.length} results</p>
      {selectedResult && (
        <OwnerInvoiceDetailModal result={selectedResult} onClose={() => setSelectedResult(null)} />
      )}
    </div>
  )
}

// Owner Invoice Detail Modal with significantly more information
function OwnerInvoiceDetailModal({ result, onClose }: { result: any; onClose: () => void }) {
  if (!result) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" onClick={onClose}>
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="fixed inset-0 bg-black/50" />
        <div
          className="relative bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between rounded-t-xl z-10">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                {result.item_description || 'Payment Application Detail'}
              </h3>
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`badge text-xs ${getSeverityColor(result.severity)}`}>
                  {getSeverityText(result.severity)}
                </span>
                {result.status && (
                  <span className={`badge text-xs ${getStatusColor(result.status)}`}>
                    {result.status?.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <div className="p-6 space-y-5">
            {/* Side-by-side comparison */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-blue-800 uppercase tracking-wide mb-3">Procore</h4>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-blue-600">Reference</dt>
                    <dd className="font-medium text-gray-900">{result.procore_ref || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-blue-600">Net Amount (w/o Retainage)</dt>
                    <dd className="font-medium text-gray-900 text-lg">
                      {result.procore_value != null ? formatCurrency(result.procore_value) : '-'}
                    </dd>
                  </div>
                  {(result.payment_app_retainage || 0) > 0 && (
                    <div>
                      <dt className="text-blue-600">Retainage Held</dt>
                      <dd className="font-medium text-orange-600">{formatCurrency(result.payment_app_retainage)}</dd>
                    </div>
                  )}
                  {(result.payment_app_retainage || 0) > 0 && result.procore_value != null && (
                    <div>
                      <dt className="text-blue-600">Gross Amount (incl. Retainage)</dt>
                      <dd className="font-medium text-gray-700">{formatCurrency(result.procore_value + (result.payment_app_retainage || 0))}</dd>
                    </div>
                  )}
                  {result.procore_date && (
                    <div>
                      <dt className="text-blue-600">Billing Date</dt>
                      <dd className="font-medium text-gray-900">{result.procore_date}</dd>
                    </div>
                  )}
                </dl>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-green-800 uppercase tracking-wide mb-3">QuickBooks</h4>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-green-600">Reference</dt>
                    <dd className="font-medium text-gray-900">{result.qb_ref || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-green-600">Invoice Amount</dt>
                    <dd className="font-medium text-gray-900 text-lg">
                      {result.qb_value != null ? formatCurrency(result.qb_value) : '-'}
                    </dd>
                  </div>
                  {(result.payment_app_retainage || 0) > 0 && (
                    <div>
                      <dt className="text-green-600">Retainage</dt>
                      <dd className="font-medium text-orange-600">{formatCurrency(result.payment_app_retainage)}</dd>
                    </div>
                  )}
                  {result.qb_date && (
                    <div>
                      <dt className="text-green-600">Invoice Date</dt>
                      <dd className="font-medium text-gray-900">{result.qb_date}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>

            {/* Variance */}
            {result.variance != null && Math.abs(result.variance) >= 1 && (
              <div className="bg-gray-50 border rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Variance</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-gray-500">Amount</dt>
                    <dd className={`text-lg font-semibold ${
                      result.variance > 0 ? 'text-red-600' : 'text-green-600'
                    }`}>
                      {formatCurrency(result.variance)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Percentage</dt>
                    <dd className={`text-lg font-semibold ${
                      (result.variance_pct || 0) !== 0 ? 'text-red-600' : 'text-gray-500'
                    }`}>
                      {result.variance_pct != null ? `${result.variance_pct.toFixed(1)}%` : '-'}
                    </dd>
                  </div>
                </div>
              </div>
            )}

            {/* Notes */}
            {result.notes && (
              <div className="bg-gray-50 border rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Notes</h4>
                <p className="text-sm text-gray-700">{result.notes}</p>
              </div>
            )}

            {/* AI Analysis */}
            {(result.ai_likely_cause || result.ai_recommended_action) && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-purple-800 uppercase tracking-wide mb-3">AI Analysis</h4>
                <dl className="space-y-2 text-sm">
                  {result.ai_likely_cause && (
                    <div>
                      <dt className="text-purple-600">Likely Cause</dt>
                      <dd className="font-medium text-gray-900">{result.ai_likely_cause}</dd>
                    </div>
                  )}
                  {result.ai_recommended_action && (
                    <div>
                      <dt className="text-purple-600">Recommended Action</dt>
                      <dd className="font-medium text-gray-900">{result.ai_recommended_action}</dd>
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

// Sub Payments tab - vendor-grouped payment comparison
function SubPaymentsTable({ report, commitments, results, billingPeriod }: { report: any; commitments: any[]; results: any[]; billingPeriod: string }) {
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set())
  const aiAnalysis = report.ai_analysis as any
  const summaries: any[] = aiAnalysis?.sub_payment_summaries || []

  if (summaries.length === 0 && commitments.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No sub payment data available</p>
      </div>
    )
  }

  // When a billing period is selected, recalculate vendor rows from filtered results
  // to show cumulative data through that period only
  const rows = (() => {
    if (billingPeriod !== 'all') {
      // Build vendor rows from filtered invoice results
      const invoiceResults = results.filter(r => r.item_type === 'invoice')
      const vendorMap = new Map<string, any>()
      // Seed with commitment data for committed_cost
      for (const c of commitments) {
        vendorMap.set(c.vendor, {
          vendor: c.vendor,
          commitment_type: c.commitment_type,
          committed_cost: c.current_value || 0,
          procore_work_billed: 0,
          procore_work_paid: 0,
          procore_retainage_held: 0,
          procore_retainage_released: 0,
          procore_retainage_paid: 0,
          qbo_work_billed: 0,
          qbo_work_paid: 0,
          qbo_retainage_held: 0,
          qbo_retainage_released: 0,
          qbo_retainage_paid: 0,
          payment_variance: 0,
          invoice_count: 0,
          billed_pct: 0,
        })
      }
      // Aggregate filtered results per vendor
      for (const r of invoiceResults) {
        const vendor = r.vendor || 'Unknown'
        if (!vendorMap.has(vendor)) {
          vendorMap.set(vendor, {
            vendor,
            commitment_type: '',
            committed_cost: 0,
            procore_work_billed: 0,
            procore_work_paid: 0,
            procore_retainage_held: 0,
            procore_retainage_released: 0,
            procore_retainage_paid: 0,
            qbo_work_billed: 0,
            qbo_work_paid: 0,
            qbo_retainage_held: 0,
            qbo_retainage_released: 0,
            qbo_retainage_paid: 0,
            payment_variance: 0,
            invoice_count: 0,
            billed_pct: 0,
          })
        }
        const v = vendorMap.get(vendor)!
        v.procore_work_billed += r.procore_value || 0
        v.qbo_work_billed += r.qb_value || 0
        v.procore_retainage_held += r.procore_retainage || 0
        v.qbo_retainage_held += r.qb_retainage || 0
        v.procore_retainage_released += r.retainage_released || 0
        v.invoice_count += 1
      }
      // Calculate derived fields
      for (const v of vendorMap.values()) {
        v.procore_work_paid = v.procore_work_billed - v.procore_retainage_held + v.procore_retainage_released
        v.qbo_work_paid = v.qbo_work_billed - v.qbo_retainage_held
        v.payment_variance = v.procore_work_paid - v.qbo_work_paid
        v.billed_pct = v.committed_cost > 0 ? (v.procore_work_billed / v.committed_cost * 100) : 0
      }
      // Only return vendors that have filtered results or commitments
      return Array.from(vendorMap.values()).filter(v => v.invoice_count > 0 || v.committed_cost > 0)
    }
    // All periods: use pre-computed summaries
    return summaries.length > 0 ? summaries : commitments.map((c: any) => ({
      vendor: c.vendor,
      commitment_type: c.commitment_type,
      committed_cost: c.current_value || 0,
      procore_work_billed: c.billed_to_date || 0,
      procore_work_paid: c.paid_to_date || 0,
      procore_retainage_held: c.retention_held || 0,
      procore_retainage_released: 0,
      procore_retainage_paid: 0,
      qbo_work_billed: 0,
      qbo_work_paid: 0,
      qbo_retainage_held: 0,
      qbo_retainage_released: 0,
      qbo_retainage_paid: 0,
      payment_variance: 0,
      invoice_count: 0,
      billed_pct: 0,
    }))
  })()

  const sorted = [...rows].sort((a, b) => a.vendor.localeCompare(b.vendor))

  const toggleVendor = (vendor: string) => {
    const newSet = new Set(expandedVendors)
    if (newSet.has(vendor)) newSet.delete(vendor)
    else newSet.add(vendor)
    setExpandedVendors(newSet)
  }

  // Grand totals
  const totals = sorted.reduce((acc, r) => ({
    committed: acc.committed + (r.committed_cost || 0),
    pWorkBilled: acc.pWorkBilled + (r.procore_work_billed || 0),
    pWorkPaid: acc.pWorkPaid + (r.procore_work_paid || 0),
    pRetHeld: acc.pRetHeld + (r.procore_retainage_held || 0),
    pRetReleased: acc.pRetReleased + (r.procore_retainage_released || 0),
    pRetPaid: acc.pRetPaid + (r.procore_retainage_paid || 0),
    qWorkBilled: acc.qWorkBilled + (r.qbo_work_billed || 0),
    qWorkPaid: acc.qWorkPaid + (r.qbo_work_paid || 0),
    qRetHeld: acc.qRetHeld + (r.qbo_retainage_held || 0),
    qRetReleased: acc.qRetReleased + (r.qbo_retainage_released || 0),
    qRetPaid: acc.qRetPaid + (r.qbo_retainage_paid || 0),
    variance: acc.variance + (r.payment_variance || 0),
  }), { committed: 0, pWorkBilled: 0, pWorkPaid: 0, pRetHeld: 0, pRetReleased: 0, pRetPaid: 0, qWorkBilled: 0, qWorkPaid: 0, qRetHeld: 0, qRetReleased: 0, qRetPaid: 0, variance: 0 })

  const getPaymentStatus = (r: any) => {
    const paidDiff = Math.abs((r.procore_work_paid || 0) - (r.qbo_work_paid || 0))
    if (paidDiff < 1 && (r.procore_work_billed || 0) > 0) return 'Reconciled'
    if ((r.procore_work_billed || 0) === 0) return 'No Billing'
    return 'Unreconciled'
  }

  const getPaymentStatusStyle = (status: string) => {
    switch (status) {
      case 'Reconciled': return 'text-green-700 bg-green-100'
      case 'No Billing': return 'text-gray-600 bg-gray-100'
      default: return 'text-red-700 bg-red-100'
    }
  }

  return (
    <div className="overflow-x-auto">
      <h3 className="text-lg font-medium mb-4">Sub Payments</h3>
      <p className="text-sm text-gray-600 mb-3">{sorted.length} vendors</p>
      <table className="min-w-full divide-y divide-gray-200 text-xs">
        <thead className="bg-gray-50">
          <tr>
            <th className="table-header px-2 py-2 text-left w-6"></th>
            <th className="table-header px-2 py-2 text-left">Vendor</th>
            <th className="table-header px-2 py-2 text-right">Committed</th>
            <th className="table-header px-2 py-2 text-right">P. Work Billed</th>
            <th className="table-header px-2 py-2 text-right">P. Work Paid</th>
            <th className="table-header px-2 py-2 text-right text-orange-600">P. Ret. Held</th>
            <th className="table-header px-2 py-2 text-right text-green-600">P. Ret. Released</th>
            <th className="table-header px-2 py-2 text-right text-blue-600">P. Ret. Paid</th>
            <th className="table-header px-2 py-2 text-right">Q. Work Billed</th>
            <th className="table-header px-2 py-2 text-right">Q. Work Paid</th>
            <th className="table-header px-2 py-2 text-right text-orange-600">Q. Ret. Held</th>
            <th className="table-header px-2 py-2 text-right text-green-600">Q. Ret. Released</th>
            <th className="table-header px-2 py-2 text-right text-blue-600">Q. Ret. Paid</th>
            <th className="table-header px-2 py-2 text-right">Pmt Variance</th>
            <th className="table-header px-2 py-2 text-center">Status</th>
            <th className="table-header px-2 py-2 text-right">Billed %</th>
            <th className="table-header px-2 py-2 text-center"># Inv</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {sorted.map((row) => {
            const status = getPaymentStatus(row)
            const isExpanded = expandedVendors.has(row.vendor)
            // Get invoice-level results for this vendor
            const vendorInvoices = results.filter(r =>
              r.item_type === 'invoice' && r.vendor &&
              r.vendor.toLowerCase() === row.vendor.toLowerCase()
            ).sort((a, b) => {
              const aDate = a.procore_date || a.billing_date || ''
              const bDate = b.procore_date || b.billing_date || ''
              return aDate.localeCompare(bDate)
            })
            return (
              <Fragment key={row.vendor}>
              <tr
                className="bg-gray-50 hover:bg-gray-100 cursor-pointer"
                onClick={() => toggleVendor(row.vendor)}
              >
                <td className="px-2 py-2">
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
                  )}
                </td>
                <td className="px-2 py-2 font-semibold text-gray-900 whitespace-nowrap">{row.vendor}</td>
                <td className="px-2 py-2 text-right">{formatCurrency(row.committed_cost || 0)}</td>
                <td className="px-2 py-2 text-right">{formatCurrency(row.procore_work_billed || 0)}</td>
                <td className="px-2 py-2 text-right">{formatCurrency(row.procore_work_paid || 0)}</td>
                <td className="px-2 py-2 text-right text-orange-600">{(row.procore_retainage_held || 0) > 0 ? formatCurrency(row.procore_retainage_held) : '-'}</td>
                <td className="px-2 py-2 text-right text-green-600">{(row.procore_retainage_released || 0) > 0 ? formatCurrency(row.procore_retainage_released) : '-'}</td>
                <td className="px-2 py-2 text-right text-blue-600">{(row.procore_retainage_paid || 0) > 0 ? formatCurrency(row.procore_retainage_paid) : '-'}</td>
                <td className="px-2 py-2 text-right">{formatCurrency(row.qbo_work_billed || 0)}</td>
                <td className="px-2 py-2 text-right">{formatCurrency(row.qbo_work_paid || 0)}</td>
                <td className="px-2 py-2 text-right text-orange-600">{(row.qbo_retainage_held || 0) > 0 ? formatCurrency(row.qbo_retainage_held) : '-'}</td>
                <td className="px-2 py-2 text-right text-green-600">{(row.qbo_retainage_released || 0) > 0 ? formatCurrency(row.qbo_retainage_released) : '-'}</td>
                <td className="px-2 py-2 text-right text-blue-600">{(row.qbo_retainage_paid || 0) > 0 ? formatCurrency(row.qbo_retainage_paid) : '-'}</td>
                <td className={`px-2 py-2 text-right font-medium ${
                  Math.abs(row.payment_variance || 0) > 1 ? 'text-red-600' : 'text-gray-500'
                }`}>
                  {formatCurrency(row.payment_variance || 0)}
                </td>
                <td className="px-2 py-2 text-center">
                  <span className={`badge text-xs ${getPaymentStatusStyle(status)}`}>{status}</span>
                </td>
                <td className="px-2 py-2 text-right">{(row.billed_pct || 0).toFixed(0)}%</td>
                <td className="px-2 py-2 text-center text-gray-500">{row.invoice_count || 0}</td>
              </tr>
              {/* Invoice detail rows when vendor is expanded */}
              {isExpanded && vendorInvoices.length > 0 && vendorInvoices.map((inv, idx) => (
                <tr
                  key={`${row.vendor}-inv-${idx}`}
                  className="bg-white hover:bg-yellow-50"
                >
                  <td className="px-2 py-1"></td>
                  <td className="px-2 py-1 pl-6 text-gray-700">
                    {inv.item_description || inv.procore_ref || `Invoice #${idx + 1}`}
                    {inv.billing_date && <span className="ml-2 text-gray-400">{inv.billing_date}</span>}
                  </td>
                  <td className="px-2 py-1 text-right text-gray-400">-</td>
                  <td className="px-2 py-1 text-right">{inv.procore_value ? formatCurrency(inv.procore_value) : '-'}</td>
                  <td className="px-2 py-1 text-right text-gray-400">-</td>
                  <td className="px-2 py-1 text-right text-orange-600">{inv.procore_retainage ? formatCurrency(inv.procore_retainage) : '-'}</td>
                  <td className="px-2 py-1 text-right text-green-600">{inv.retainage_released ? formatCurrency(inv.retainage_released) : '-'}</td>
                  <td className="px-2 py-1 text-right text-blue-600">-</td>
                  <td className="px-2 py-1 text-right">{inv.qb_value ? formatCurrency(inv.qb_value) : '-'}</td>
                  <td className="px-2 py-1 text-right text-gray-400">-</td>
                  <td className="px-2 py-1 text-right text-orange-600">{inv.qb_retainage ? formatCurrency(inv.qb_retainage) : '-'}</td>
                  <td className="px-2 py-1 text-right text-green-600">-</td>
                  <td className="px-2 py-1 text-right text-blue-600">-</td>
                  <td className={`px-2 py-1 text-right ${
                    (inv.variance || 0) > 0 ? 'text-red-600' : (inv.variance || 0) < 0 ? 'text-green-600' : 'text-gray-500'
                  }`}>
                    {inv.variance != null ? formatCurrency(inv.variance) : '-'}
                  </td>
                  <td className="px-2 py-1 text-center">
                    <span className={`text-xs ${inv.severity === 'critical' ? 'text-red-600' : inv.severity === 'warning' ? 'text-yellow-600' : 'text-gray-500'}`}>
                      {inv.severity === 'critical' ? 'Critical' : inv.severity === 'warning' ? 'Warning' : 'OK'}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right text-gray-400 text-xs">{inv.procore_ref || '-'}</td>
                  <td className="px-2 py-1 text-center text-gray-400 text-xs">{inv.qb_ref || '-'}</td>
                </tr>
              ))}
              {isExpanded && vendorInvoices.length === 0 && (
                <tr key={`${row.vendor}-empty`}>
                  <td className="px-2 py-1"></td>
                  <td className="px-2 py-1 pl-6 text-gray-400 italic" colSpan={16}>No invoice details available</td>
                </tr>
              )}
              </Fragment>
            )
          })}
        </tbody>
        <tfoot className="bg-gray-100 font-semibold text-xs">
          <tr>
            <td className="px-2 py-2"></td>
            <td className="px-2 py-2">GRAND TOTAL</td>
            <td className="px-2 py-2 text-right">{formatCurrency(totals.committed)}</td>
            <td className="px-2 py-2 text-right">{formatCurrency(totals.pWorkBilled)}</td>
            <td className="px-2 py-2 text-right">{formatCurrency(totals.pWorkPaid)}</td>
            <td className="px-2 py-2 text-right text-orange-600">{totals.pRetHeld > 0 ? formatCurrency(totals.pRetHeld) : '-'}</td>
            <td className="px-2 py-2 text-right text-green-600">{totals.pRetReleased > 0 ? formatCurrency(totals.pRetReleased) : '-'}</td>
            <td className="px-2 py-2 text-right text-blue-600">{totals.pRetPaid > 0 ? formatCurrency(totals.pRetPaid) : '-'}</td>
            <td className="px-2 py-2 text-right">{formatCurrency(totals.qWorkBilled)}</td>
            <td className="px-2 py-2 text-right">{formatCurrency(totals.qWorkPaid)}</td>
            <td className="px-2 py-2 text-right text-orange-600">{totals.qRetHeld > 0 ? formatCurrency(totals.qRetHeld) : '-'}</td>
            <td className="px-2 py-2 text-right text-green-600">{totals.qRetReleased > 0 ? formatCurrency(totals.qRetReleased) : '-'}</td>
            <td className="px-2 py-2 text-right text-blue-600">{totals.qRetPaid > 0 ? formatCurrency(totals.qRetPaid) : '-'}</td>
            <td className={`px-2 py-2 text-right ${Math.abs(totals.variance) > 1 ? 'text-red-600' : ''}`}>
              {formatCurrency(totals.variance)}
            </td>
            <td className="px-2 py-2" colSpan={3}></td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// Owner Payments tab
function OwnerPaymentsTable({ report, results, billingPeriod }: { report: any; results: any[]; billingPeriod: string }) {
  const aiAnalysis = report.ai_analysis as any
  const summary = aiAnalysis?.owner_payment_summary
  const allProcorePayApps: any[] = summary?.procore_payment_apps || []
  const allOwnerInvoices: any[] = summary?.owner_invoices || []
  const allOwnerPayments: any[] = summary?.owner_payments || []

  // Filter helper for summary-level items by date
  const filterItemByPeriod = (date: string | null | undefined) => {
    if (billingPeriod === 'all' || !date) return true
    const d = new Date(date)
    if (isNaN(d.getTime())) return true
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return period <= billingPeriod
  }

  const procorePayApps = allProcorePayApps.filter((a: any) => filterItemByPeriod(a.billing_date))
  const ownerInvoices = allOwnerInvoices.filter((inv: any) => filterItemByPeriod(inv.date))
  const ownerPayments = allOwnerPayments.filter((p: any) => filterItemByPeriod(p.date))

  // Reconciliation results for payment_app type (already period-filtered via results prop)
  const payAppResults = results.filter(r => r.item_type === 'payment_app')

  if (!summary && ownerInvoices.length === 0 && procorePayApps.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No owner payment data available</p>
      </div>
    )
  }

  // Summary metrics — recalculate from filtered data
  const procoreWorkBilled = procorePayApps.reduce((sum: number, a: any) => sum + (a.approved_amount || a.total_amount || 0), 0)
  const procoreWorkPaid = procorePayApps.reduce((sum: number, a: any) => sum + (a.net_amount || a.approved_amount || 0), 0)
  const procoreRetHeld = procorePayApps.reduce((sum: number, a: any) => sum + (a.retainage || 0), 0)
  const qboTotalInvoiced = ownerInvoices.reduce((sum: number, inv: any) => sum + (inv.amount || 0), 0)
  const qboTotalPaid = ownerPayments.reduce((sum: number, p: any) => sum + (p.amount || 0), 0)
  const qboOutstandingBalance = ownerInvoices.reduce((sum: number, inv: any) => sum + (inv.balance || 0), 0)

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">Owner Payments</h3>

      {/* Summary comparison */}
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
              <td className="py-2 pr-4 text-gray-700">Work Billed</td>
              <td className="py-2 px-4 text-right font-medium">{formatCurrency(procoreWorkBilled)}</td>
              <td className="py-2 px-4 text-right font-medium">{formatCurrency(qboTotalInvoiced)}</td>
              <td className={`py-2 pl-4 text-right font-medium ${
                Math.abs(procoreWorkBilled - (qboTotalInvoiced)) > 1 ? 'text-red-600' : 'text-green-600'
              }`}>
                {formatCurrency(procoreWorkBilled - (qboTotalInvoiced))}
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-4 text-gray-700">Work Paid (Net of Retainage)</td>
              <td className="py-2 px-4 text-right font-medium">{formatCurrency(procoreWorkPaid)}</td>
              <td className="py-2 px-4 text-right font-medium">{formatCurrency(qboTotalPaid)}</td>
              <td className={`py-2 pl-4 text-right font-medium ${
                Math.abs(procoreWorkPaid - (qboTotalPaid)) > 1 ? 'text-red-600' : 'text-green-600'
              }`}>
                {formatCurrency(procoreWorkPaid - (qboTotalPaid))}
              </td>
            </tr>
            <tr>
              <td className="py-2 pr-4 text-gray-700">Retainage Held</td>
              <td className="py-2 px-4 text-right font-medium">{formatCurrency(procoreRetHeld)}</td>
              <td className="py-2 px-4 text-right font-medium text-gray-400">-</td>
              <td className="py-2 pl-4 text-right font-medium text-gray-400">-</td>
            </tr>
            <tr>
              <td className="py-2 pr-4 text-gray-700">Outstanding Balance</td>
              <td className="py-2 px-4 text-right font-medium text-gray-400">-</td>
              <td className="py-2 px-4 text-right font-medium">{formatCurrency(qboOutstandingBalance)}</td>
              <td className="py-2 pl-4 text-right font-medium text-gray-400">-</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Pay App ↔ Invoice Reconciliation */}
      {payAppResults.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Pay App / Invoice Reconciliation</h4>
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-header px-3 py-2 text-left">Description</th>
                <th className="table-header px-3 py-2 text-left">Procore Ref</th>
                <th className="table-header px-3 py-2 text-left">Procore Date</th>
                <th className="table-header px-3 py-2 text-right">Procore Amount</th>
                <th className="table-header px-3 py-2 text-left">QB Ref</th>
                <th className="table-header px-3 py-2 text-left">QB Date</th>
                <th className="table-header px-3 py-2 text-right">QB Amount</th>
                <th className="table-header px-3 py-2 text-right">Variance</th>
                <th className="table-header px-3 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {payAppResults.sort((a: any, b: any) => (a.procore_date || a.qb_date || '').localeCompare(b.procore_date || b.qb_date || '')).map((r: any, idx: number) => {
                const statusLabel = r.notes?.includes('Matched') ? 'Matched'
                  : r.notes?.includes('No matching') ? 'Unmatched'
                  : r.notes?.includes('no matching Procore') ? 'QB Only'
                  : 'Variance'
                const statusStyle = statusLabel === 'Matched' ? 'text-green-700 bg-green-100'
                  : statusLabel === 'Unmatched' || statusLabel === 'QB Only' ? 'text-red-700 bg-red-100'
                  : 'text-yellow-700 bg-yellow-100'
                return (
                  <tr key={r.id || idx} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900">{r.item_description || '-'}</td>
                    <td className="px-3 py-2 text-gray-600">{r.procore_ref || '-'}</td>
                    <td className="px-3 py-2 text-gray-600">{r.procore_date || '-'}</td>
                    <td className="px-3 py-2 text-right">{r.procore_value != null ? formatCurrency(r.procore_value) : '-'}</td>
                    <td className="px-3 py-2 text-gray-600">{r.qb_ref || '-'}</td>
                    <td className="px-3 py-2 text-gray-600">{r.qb_date || '-'}</td>
                    <td className="px-3 py-2 text-right">{r.qb_value != null ? formatCurrency(r.qb_value) : '-'}</td>
                    <td className={`px-3 py-2 text-right font-medium ${
                      Math.abs(r.variance || 0) > 1 ? 'text-red-600' : 'text-gray-500'
                    }`}>
                      {r.variance != null ? formatCurrency(r.variance) : '-'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`badge text-xs ${statusStyle}`}>{statusLabel}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Procore Payment Applications detail */}
      {procorePayApps.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Procore Payment Applications</h4>
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-header px-3 py-2 text-left">Pay App #</th>
                <th className="table-header px-3 py-2 text-left">Date</th>
                <th className="table-header px-3 py-2 text-left">Status</th>
                <th className="table-header px-3 py-2 text-right">Approved Amount</th>
                <th className="table-header px-3 py-2 text-right text-orange-600">Retainage</th>
                <th className="table-header px-3 py-2 text-right text-green-600">Net Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {procorePayApps.map((app: any, idx: number) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">#{app.number || idx + 1}</td>
                  <td className="px-3 py-2 text-gray-600">{app.billing_date || '-'}</td>
                  <td className="px-3 py-2">
                    <span className={`badge text-xs ${
                      app.status === 'approved' ? 'text-green-700 bg-green-100' :
                      app.status === 'draft' ? 'text-gray-600 bg-gray-100' :
                      'text-yellow-700 bg-yellow-100'
                    }`}>{app.status || '-'}</span>
                  </td>
                  <td className="px-3 py-2 text-right">{formatCurrency(app.approved_amount || app.total_amount || 0)}</td>
                  <td className="px-3 py-2 text-right text-orange-600">{(app.retainage || 0) > 0 ? formatCurrency(app.retainage) : '-'}</td>
                  <td className="px-3 py-2 text-right text-green-600">{formatCurrency(app.net_amount || app.approved_amount || 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-100 font-semibold text-xs">
              <tr>
                <td className="px-3 py-2" colSpan={3}>TOTAL</td>
                <td className="px-3 py-2 text-right">{formatCurrency(procorePayApps.reduce((s: number, a: any) => s + (a.approved_amount || a.total_amount || 0), 0))}</td>
                <td className="px-3 py-2 text-right text-orange-600">{formatCurrency(procorePayApps.reduce((s: number, a: any) => s + (a.retainage || 0), 0))}</td>
                <td className="px-3 py-2 text-right text-green-600">{formatCurrency(procorePayApps.reduce((s: number, a: any) => s + (a.net_amount || a.approved_amount || 0), 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Owner invoices detail */}
      {ownerInvoices.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">QB Invoices to Owner</h4>
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-header px-3 py-2 text-left">Invoice #</th>
                <th className="table-header px-3 py-2 text-left">Customer</th>
                <th className="table-header px-3 py-2 text-left">Date</th>
                <th className="table-header px-3 py-2 text-right">Amount</th>
                <th className="table-header px-3 py-2 text-right">Balance</th>
                <th className="table-header px-3 py-2 text-right">Paid</th>
                <th className="table-header px-3 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {ownerInvoices.map((inv: any, idx: number) => {
                const paid = (inv.amount || 0) - (inv.balance || 0)
                return (
                  <tr key={inv.id || idx} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{inv.doc_number || '-'}</td>
                    <td className="px-3 py-2 text-gray-600">{inv.customer || '-'}</td>
                    <td className="px-3 py-2 text-gray-600">{inv.date || '-'}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(inv.amount || 0)}</td>
                    <td className="px-3 py-2 text-right text-orange-600">{formatCurrency(inv.balance || 0)}</td>
                    <td className="px-3 py-2 text-right text-green-600">{formatCurrency(paid)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`badge text-xs ${(inv.balance || 0) <= 0 ? 'text-green-700 bg-green-100' : 'text-orange-700 bg-orange-100'}`}>
                        {(inv.balance || 0) <= 0 ? 'Paid' : 'Outstanding'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Owner payments detail */}
      {ownerPayments.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">QB Payments Received</h4>
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-header px-3 py-2 text-left">Payment ID</th>
                <th className="table-header px-3 py-2 text-left">Customer</th>
                <th className="table-header px-3 py-2 text-left">Date</th>
                <th className="table-header px-3 py-2 text-right">Amount</th>
                <th className="table-header px-3 py-2 text-left">Applied To</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {ownerPayments.map((pmt: any, idx: number) => (
                <tr key={pmt.id || idx} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">{pmt.id || '-'}</td>
                  <td className="px-3 py-2 text-gray-600">{pmt.customer || '-'}</td>
                  <td className="px-3 py-2 text-gray-600">{pmt.date || '-'}</td>
                  <td className="px-3 py-2 text-right font-medium text-green-600">{formatCurrency(pmt.amount || 0)}</td>
                  <td className="px-3 py-2 text-gray-500">
                    {pmt.invoice_ids?.length > 0 ? `${pmt.invoice_ids.length} invoice(s)` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

function UnbilledCommitmentsTable({ commitments }: { commitments: any[] }) {
  if (commitments.length === 0) {
    return (
      <div className="text-center py-8">
        <CheckCircle className="w-10 h-10 text-green-400 mx-auto mb-2" />
        <p className="text-gray-500">All commitments have billing activity</p>
      </div>
    )
  }

  const totalExposure = commitments.reduce((sum: number, c: any) => sum + (c.current_value || 0), 0)

  return (
    <div>
      {/* Warning banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              {commitments.length} commitment{commitments.length !== 1 ? 's' : ''} with no invoices submitted
            </p>
            <p className="text-sm text-amber-700 mt-1">
              These subcontracts or purchase orders have contract value but zero billing to date.
              Do not close out this project until these are resolved — they may still bill against the job.
            </p>
            <p className="text-sm font-semibold text-amber-900 mt-2">
              Total unbilled exposure: {formatCurrency(totalExposure)}
            </p>
          </div>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Vendor</th>
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Commitment</th>
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Type</th>
            <th className="text-left px-3 py-2 text-gray-500 font-medium">Status</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Contract Value</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Billed</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Paid</th>
            <th className="text-right px-3 py-2 text-gray-500 font-medium">Retainage</th>
          </tr>
        </thead>
        <tbody>
          {commitments.map((c: any) => (
            <tr key={c.id} className="border-b border-gray-100 hover:bg-amber-50/50">
              <td className="px-3 py-3 font-medium text-gray-900">{c.vendor || '-'}</td>
              <td className="px-3 py-3 text-gray-600 max-w-xs truncate" title={c.title}>{c.title || '-'}</td>
              <td className="px-3 py-3">
                <span className="badge text-xs bg-gray-100 text-gray-600">
                  {c.commitment_type === 'purchase_order' ? 'Purchase Order' : 'Subcontract'}
                </span>
              </td>
              <td className="px-3 py-3">
                <span className={`badge text-xs ${
                  c.status === 'approved' || c.status === 'complete' ? 'bg-green-100 text-green-700'
                    : c.status === 'draft' ? 'bg-gray-100 text-gray-600'
                    : 'bg-blue-100 text-blue-700'
                }`}>
                  {c.status || '-'}
                </span>
              </td>
              <td className="px-3 py-3 text-right font-semibold text-gray-900">
                {formatCurrency(c.current_value || 0)}
              </td>
              <td className="px-3 py-3 text-right text-red-500 font-medium">
                {formatCurrency(0)}
              </td>
              <td className="px-3 py-3 text-right text-gray-500">
                {formatCurrency(c.paid_to_date || 0)}
              </td>
              <td className="px-3 py-3 text-right text-orange-500">
                {c.retention_held > 0 ? formatCurrency(c.retention_held) : '-'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-300 font-semibold">
            <td className="px-3 py-2 text-gray-700" colSpan={4}>Total Unbilled Exposure</td>
            <td className="px-3 py-2 text-right text-gray-900">{formatCurrency(totalExposure)}</td>
            <td className="px-3 py-2 text-right text-red-500">{formatCurrency(0)}</td>
            <td className="px-3 py-2 text-right text-gray-500">
              {formatCurrency(commitments.reduce((s: number, c: any) => s + (c.paid_to_date || 0), 0))}
            </td>
            <td className="px-3 py-2 text-right text-orange-500">
              {formatCurrency(commitments.reduce((s: number, c: any) => s + (c.retention_held || 0), 0))}
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="text-xs text-gray-400 mt-2">
        {commitments.length} unbilled commitment{commitments.length !== 1 ? 's' : ''}
      </p>
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
