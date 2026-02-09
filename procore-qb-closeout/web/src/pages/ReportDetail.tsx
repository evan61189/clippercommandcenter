import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ArrowLeft,
  AlertCircle,
  AlertTriangle,
  FileText,
  CheckCircle,
  RefreshCw,
  Loader2,
} from 'lucide-react'
import {
  getReport,
  getResultsForReport,
  getCloseoutItemsForReport,
  getCommitmentsForReport,
} from '../lib/supabase'
import {
  formatCurrency,
  formatDateTime,
  getSeverityColor,
  getStatusColor,
  getPriorityLabel,
  getPriorityColor,
} from '../lib/utils'

type TabType = 'summary' | 'sub_invoices' | 'owner_invoices' | 'direct_costs' | 'warnings' | 'closeout'

export default function ReportDetail() {
  const { reportId } = useParams<{ reportId: string }>()
  const [activeTab, setActiveTab] = useState<TabType>('summary')
  const [isUpdating, setIsUpdating] = useState(false)

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
  const subInvoiceResults = results?.filter(r => r.item_type === 'invoice') || []
  const ownerInvoiceResults = results?.filter(r => r.item_type === 'payment_app') || []
  const directCostResults = results?.filter(r => r.item_type === 'direct_cost') || []

  // Generate warnings based on the data
  const warnings = generateWarnings(results || [], commitments || [], report)

  const tabs = [
    { id: 'summary' as TabType, label: 'Summary', count: null },
    { id: 'sub_invoices' as TabType, label: 'Sub Invoices', count: subInvoiceResults.length },
    { id: 'owner_invoices' as TabType, label: 'Owner Invoices', count: ownerInvoiceResults.length },
    { id: 'direct_costs' as TabType, label: 'Direct Costs', count: directCostResults.length },
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
            <span className={`badge ${report.status === 'complete' ? 'badge-info' : 'badge-warning'}`}>
              {report.status}
            </span>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
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
          <div className="bg-red-50 rounded-lg p-4">
            <p className="text-sm text-red-600">Estimated Exposure</p>
            <p className="text-xl font-semibold text-red-700">
              {formatCurrency(report.estimated_exposure)}
            </p>
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
          </div>
        )}

        {activeTab === 'sub_invoices' && (
          <ResultsTable results={subInvoiceResults} title="Subcontractor Invoices" />
        )}

        {activeTab === 'owner_invoices' && (
          <ResultsTable results={ownerInvoiceResults} title="Owner Invoices" />
        )}

        {activeTab === 'direct_costs' && (
          <ResultsTable results={directCostResults} title="Direct Costs" />
        )}

        {activeTab === 'warnings' && (
          <WarningsTable warnings={warnings} />
        )}

        {activeTab === 'closeout' && (
          <CloseoutItemsTable items={closeoutItems || []} />
        )}
      </div>
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
  const uncommittedContracts = commitments?.filter(
    c => !['approved', 'void', 'terminated'].includes(c.status?.toLowerCase())
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

type SortField = 'item_description' | 'vendor' | 'procore_value' | 'qb_value' | 'variance' | 'severity' | 'notes' | 'status' | 'procore_ref' | 'qb_ref'
type SortDir = 'asc' | 'desc'

function ResultsTable({ results, title }: { results: any[]; title?: string }) {
  const [sortField, setSortField] = useState<SortField>('vendor')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

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
            <SortHeader field="qb_ref" label="QB Ref" />
            <SortHeader field="qb_value" label="QB $" className="text-right" />
            <SortHeader field="variance" label="Variance" className="text-right" />
            <SortHeader field="severity" label="Match" />
            <SortHeader field="notes" label="Notes" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {sortedResults.map((result, idx) => (
            <tr key={result.id || idx} className="hover:bg-yellow-50">
              <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">
                {result.vendor || '-'}
              </td>
              <td className="px-3 py-2 text-gray-700 max-w-xs truncate" title={result.item_description}>
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
                  {result.severity || 'unknown'}
                </span>
              </td>
              <td className="px-3 py-2 text-gray-500 max-w-xs truncate" title={result.notes}>
                {result.notes || '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-400 mt-2">Showing {sortedResults.length} results</p>
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
