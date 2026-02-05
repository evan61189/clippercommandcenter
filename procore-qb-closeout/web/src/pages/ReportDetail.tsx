import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ArrowLeft,
  AlertCircle,
  DollarSign,
  FileText,
  TrendingUp,
  CheckCircle,
} from 'lucide-react'
import {
  getReport,
  getResultsForReport,
  getCloseoutItemsForReport,
} from '../lib/supabase'
import {
  formatCurrency,
  formatDateTime,
  getSeverityColor,
  getStatusColor,
  getPriorityLabel,
  getPriorityColor,
} from '../lib/utils'

type TabType = 'summary' | 'commitments' | 'invoices' | 'change_orders' | 'retention' | 'budget' | 'closeout'

export default function ReportDetail() {
  const { reportId } = useParams<{ reportId: string }>()
  const [activeTab, setActiveTab] = useState<TabType>('summary')

  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ['report', reportId],
    queryFn: () => getReport(reportId!),
    enabled: !!reportId,
  })

  const { data: results, isLoading: resultsLoading } = useQuery({
    queryKey: ['report-results', reportId],
    queryFn: () => getResultsForReport(reportId!),
    enabled: !!reportId,
  })

  const { data: closeoutItems, isLoading: closeoutLoading } = useQuery({
    queryKey: ['report-closeout', reportId],
    queryFn: () => getCloseoutItemsForReport(reportId!),
    enabled: !!reportId,
  })

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
  const commitmentResults = results?.filter(r => r.item_type === 'commitment') || []
  const invoiceResults = results?.filter(r => r.item_type === 'invoice') || []
  const changeOrderResults = results?.filter(r => r.item_type === 'change_order') || []
  const retentionResults = results?.filter(r => r.item_type === 'retention') || []
  const budgetResults = results?.filter(r => r.item_type === 'budget') || []

  const tabs = [
    { id: 'summary' as TabType, label: 'Summary', count: null },
    { id: 'commitments' as TabType, label: 'Commitments', count: commitmentResults.length },
    { id: 'invoices' as TabType, label: 'Invoices', count: invoiceResults.length },
    { id: 'change_orders' as TabType, label: 'Change Orders', count: changeOrderResults.length },
    { id: 'retention' as TabType, label: 'Retention', count: retentionResults.length },
    { id: 'budget' as TabType, label: 'Budget', count: budgetResults.length },
    { id: 'closeout' as TabType, label: 'Closeout Items', count: closeoutItems?.length || 0 },
  ]

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
              Closeout Reconciliation Report
            </h1>
            <p className="text-gray-500 mt-1">
              {report.projects?.name}
              {' · '}
              Generated {formatDateTime(report.generated_at)}
            </p>
          </div>
          <span className={`badge ${report.status === 'complete' ? 'badge-info' : 'badge-warning'}`}>
            {report.status}
          </span>
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

        {activeTab === 'commitments' && (
          <ResultsTable results={commitmentResults} />
        )}

        {activeTab === 'invoices' && (
          <ResultsTable results={invoiceResults} />
        )}

        {activeTab === 'change_orders' && (
          <ResultsTable results={changeOrderResults} />
        )}

        {activeTab === 'retention' && (
          <ResultsTable results={retentionResults} />
        )}

        {activeTab === 'budget' && (
          <ResultsTable results={budgetResults} />
        )}

        {activeTab === 'closeout' && (
          <CloseoutItemsTable items={closeoutItems || []} />
        )}
      </div>
    </div>
  )
}

function ResultsTable({ results }: { results: any[] }) {
  if (results.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No results in this category</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr>
            <th className="table-header px-4 py-3">Description</th>
            <th className="table-header px-4 py-3">Vendor</th>
            <th className="table-header px-4 py-3 text-right">Procore</th>
            <th className="table-header px-4 py-3 text-right">QuickBooks</th>
            <th className="table-header px-4 py-3 text-right">Variance</th>
            <th className="table-header px-4 py-3">Severity</th>
            <th className="table-header px-4 py-3">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {results.map((result) => (
            <tr key={result.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-sm">
                {result.item_description}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">
                {result.vendor || '-'}
              </td>
              <td className="px-4 py-3 text-sm text-right">
                {formatCurrency(result.procore_value)}
              </td>
              <td className="px-4 py-3 text-sm text-right">
                {formatCurrency(result.qb_value)}
              </td>
              <td className={`px-4 py-3 text-sm text-right font-medium ${
                result.variance > 0 ? 'text-red-600' : result.variance < 0 ? 'text-green-600' : ''
              }`}>
                {formatCurrency(result.variance)}
              </td>
              <td className="px-4 py-3">
                <span className={`badge ${getSeverityColor(result.severity)}`}>
                  {result.severity}
                </span>
              </td>
              <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">
                {result.notes || '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
