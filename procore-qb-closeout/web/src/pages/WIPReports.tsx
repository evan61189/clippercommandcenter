import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  FileBarChart,
  ArrowRight,
  CheckCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  Building2,
} from 'lucide-react'
import { getWIPReports, isSupabaseConfigured, WIPReport } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'

function formatMonthYear(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function WIPReports() {
  const { data: wipReports, isLoading } = useQuery({
    queryKey: ['wip-reports'],
    queryFn: getWIPReports,
    enabled: isSupabaseConfigured,
  })

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">WIP Reports</h1>
        <p className="mt-1 text-sm text-gray-500">
          Work In Progress reports - monthly snapshots of project financials
        </p>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start">
          <FileBarChart className="w-5 h-5 text-blue-500 mt-0.5 mr-3" />
          <div>
            <h3 className="text-sm font-medium text-blue-800">About WIP Reports</h3>
            <p className="text-sm text-blue-700 mt-1">
              WIP (Work In Progress) reports provide a monthly snapshot of all active project
              financials. They track contract values, costs to date, billings, and over/under
              billing status. WIP reports are generated when you close a month from the Month-End
              Reconciliation page.
            </p>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      {wipReports && wipReports.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="card text-center">
            <p className="text-sm text-gray-500">Total Reports</p>
            <p className="text-2xl font-semibold text-blue-600">{wipReports.length}</p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Latest Report</p>
            <p className="text-xl font-semibold text-gray-900">
              {formatMonthYear(wipReports[0]?.month_end_date)}
            </p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Finalized</p>
            <p className="text-2xl font-semibold text-green-600">
              {wipReports.filter(r => r.status === 'finalized').length}
            </p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Draft</p>
            <p className="text-2xl font-semibold text-yellow-600">
              {wipReports.filter(r => r.status === 'draft').length}
            </p>
          </div>
        </div>
      )}

      {/* Reports List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-procore-blue"></div>
        </div>
      ) : wipReports && wipReports.length > 0 ? (
        <div className="space-y-4">
          {wipReports.map((report) => (
            <WIPReportCard key={report.id} report={report} />
          ))}
        </div>
      ) : (
        <div className="card text-center py-12">
          <FileBarChart className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No WIP Reports Yet</h3>
          <p className="text-gray-500 mt-1 mb-4">
            WIP reports are generated when you close a month from Month-End Reconciliation
          </p>
          <Link
            to="/month-end-closeouts"
            className="inline-flex items-center px-4 py-2 bg-procore-blue text-white rounded-lg hover:bg-blue-700"
          >
            Go to Month-End Reconciliation
          </Link>
        </div>
      )}
    </div>
  )
}

function WIPReportCard({ report }: { report: WIPReport }) {
  const [expanded, setExpanded] = useState(false)
  const isOverBilled = report.total_over_under_billing > 0
  const isUnderBilled = report.total_over_under_billing < 0

  return (
    <div className="card">
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center space-x-4">
          <div className={`rounded-lg p-3 ${report.status === 'finalized' ? 'bg-green-100' : 'bg-yellow-100'}`}>
            {report.status === 'finalized' ? (
              <CheckCircle className="w-6 h-6 text-green-600" />
            ) : (
              <Clock className="w-6 h-6 text-yellow-600" />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">
              {formatMonthYear(report.month_end_date)}
            </h3>
            <p className="text-sm text-gray-500">
              Generated {formatDate(report.generated_at)}
              {report.status === 'finalized' && report.finalized_at && (
                <> · Finalized {formatDate(report.finalized_at)}</>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-6">
          <div className="text-right">
            <p className="text-xs text-gray-500 uppercase">Projects</p>
            <div className="flex items-center text-lg font-semibold text-gray-900">
              <Building2 className="w-4 h-4 mr-1 text-gray-400" />
              {report.total_projects}
            </div>
          </div>

          <div className="text-right">
            <p className="text-xs text-gray-500 uppercase">Contract Value</p>
            <p className="text-lg font-semibold text-gray-900">
              {formatCurrency(report.total_contract_value)}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs text-gray-500 uppercase">Over/Under Billing</p>
            <div className={`flex items-center text-lg font-semibold ${
              isOverBilled ? 'text-green-600' : isUnderBilled ? 'text-red-600' : 'text-gray-900'
            }`}>
              {isOverBilled && <TrendingUp className="w-4 h-4 mr-1" />}
              {isUnderBilled && <TrendingDown className="w-4 h-4 mr-1" />}
              {formatCurrency(Math.abs(report.total_over_under_billing))}
              {isOverBilled && ' Over'}
              {isUnderBilled && ' Under'}
            </div>
          </div>

          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
            report.status === 'finalized'
              ? 'bg-green-100 text-green-700'
              : 'bg-yellow-100 text-yellow-700'
          }`}>
            {report.status === 'finalized' ? 'Finalized' : 'Draft'}
          </span>

          <ArrowRight className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="mt-6 pt-6 border-t border-gray-200">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">Total Projects</p>
              <p className="text-xl font-semibold text-gray-900">{report.total_projects}</p>
            </div>
            <div className="text-center p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-600">Contract Value</p>
              <p className="text-xl font-semibold text-blue-700">
                {formatCurrency(report.total_contract_value)}
              </p>
            </div>
            <div className="text-center p-3 bg-purple-50 rounded-lg">
              <p className="text-sm text-purple-600">Cost to Date</p>
              <p className="text-xl font-semibold text-purple-700">
                {formatCurrency(report.total_cost_to_date)}
              </p>
            </div>
            <div className="text-center p-3 bg-orange-50 rounded-lg">
              <p className="text-sm text-orange-600">Billing to Date</p>
              <p className="text-xl font-semibold text-orange-700">
                {formatCurrency(report.total_billing_to_date)}
              </p>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <p className="text-sm text-green-600">Projected Gross Profit</p>
              <p className="text-xl font-semibold text-green-700">
                {formatCurrency(report.total_projected_gross_profit)}
              </p>
            </div>
          </div>

          {/* Project Details from report_data */}
          {report.report_data?.projects && report.report_data.projects.length > 0 && (
            <div>
              <h4 className="font-medium text-gray-900 mb-3">Project Breakdown</h4>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Project</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">Contract Value</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">Cost to Date</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">Billing to Date</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">Over/Under</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-600">% Complete</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {report.report_data.projects.map((project: any, idx: number) => {
                      const overUnder = project.overUnderBilling || 0
                      return (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-gray-900">{project.name}</td>
                          <td className="px-4 py-2 text-right text-gray-700">
                            {formatCurrency(project.contractValue || 0)}
                          </td>
                          <td className="px-4 py-2 text-right text-gray-700">
                            {formatCurrency(project.costToDate || 0)}
                          </td>
                          <td className="px-4 py-2 text-right text-gray-700">
                            {formatCurrency(project.billingToDate || 0)}
                          </td>
                          <td className={`px-4 py-2 text-right font-medium ${
                            overUnder > 0 ? 'text-green-600' : overUnder < 0 ? 'text-red-600' : 'text-gray-700'
                          }`}>
                            {overUnder > 0 ? '+' : ''}{formatCurrency(overUnder)}
                          </td>
                          <td className="px-4 py-2 text-right text-gray-700">
                            {((project.percentComplete || 0) * 100).toFixed(1)}%
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
