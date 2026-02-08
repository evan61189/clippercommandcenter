import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Calendar, AlertTriangle, AlertCircle, ArrowRight, Play } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'

interface MonthEndReport {
  id: string
  generated_at: string
  reconciliation_type: string
  total_committed: number
  estimated_exposure: number
  warning_items: number
  critical_items: number
  projects_included: number
}

async function getMonthEndReports(): Promise<MonthEndReport[]> {
  const { data, error } = await supabase
    .from('reconciliation_reports')
    .select('*')
    .eq('reconciliation_type', 'month_end')
    .order('generated_at', { ascending: false })

  if (error) throw error

  // Group by month and return summary for each
  return data || []
}

function formatMonthYear(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
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

export default function MonthEndCloseouts() {
  const { data: reports, isLoading } = useQuery({
    queryKey: ['month-end-reports'],
    queryFn: getMonthEndReports,
    enabled: isSupabaseConfigured,
  })

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Month-End Closeouts</h1>
          <p className="mt-1 text-sm text-gray-500">
            Reconciliation reports across all active projects at month-end
          </p>
        </div>
        <Link
          to="/run?mode=month-end"
          className="flex items-center px-6 py-3 bg-procore-blue text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm"
        >
          <Play className="w-5 h-5 mr-2" />
          Run Month-End Reconciliation
        </Link>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start">
          <Calendar className="w-5 h-5 text-blue-500 mt-0.5 mr-3" />
          <div>
            <h3 className="text-sm font-medium text-blue-800">About Month-End Closeouts</h3>
            <p className="text-sm text-blue-700 mt-1">
              Month-End reconciliation runs across all active projects. This is typically performed
              during the blackout period between the 26th and the last day of each month.
            </p>
          </div>
        </div>
      </div>

      {/* Reports List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-procore-blue"></div>
        </div>
      ) : reports && reports.length > 0 ? (
        <div className="space-y-4">
          {reports.map((report) => (
            <Link
              key={report.id}
              to={`/report/${report.id}`}
              className="block card hover:shadow-lg transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="bg-blue-100 rounded-lg p-3">
                    <Calendar className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {formatMonthYear(report.generated_at)} Month-End Closeout
                    </h3>
                    <p className="text-sm text-gray-500">
                      Generated {formatDate(report.generated_at)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-6">
                  <div className="text-right">
                    <p className="text-xs text-gray-500 uppercase">Total Committed</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {formatCurrency(report.total_committed || 0)}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-xs text-gray-500 uppercase">Exposure</p>
                    <p className={`text-lg font-semibold ${(report.estimated_exposure || 0) > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                      {formatCurrency(report.estimated_exposure || 0)}
                    </p>
                  </div>

                  <div className="flex items-center space-x-3">
                    {(report.warning_items || 0) > 0 && (
                      <div className="flex items-center text-yellow-600">
                        <AlertTriangle className="w-4 h-4 mr-1" />
                        <span className="text-sm font-medium">{report.warning_items}</span>
                      </div>
                    )}
                    {(report.critical_items || 0) > 0 && (
                      <div className="flex items-center text-red-600">
                        <AlertCircle className="w-4 h-4 mr-1" />
                        <span className="text-sm font-medium">{report.critical_items}</span>
                      </div>
                    )}
                  </div>

                  <ArrowRight className="w-5 h-5 text-gray-400" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card text-center py-12">
          <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No Month-End Closeouts Yet</h3>
          <p className="text-gray-500 mt-1 mb-4">
            Run your first month-end reconciliation to see reports here
          </p>
          <Link
            to="/run?mode=month-end"
            className="inline-flex items-center px-4 py-2 bg-procore-blue text-white rounded-lg hover:bg-blue-700"
          >
            <Play className="w-4 h-4 mr-2" />
            Run Month-End Reconciliation
          </Link>
        </div>
      )}
    </div>
  )
}
