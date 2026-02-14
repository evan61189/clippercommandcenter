import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FolderCheck, AlertTriangle, AlertCircle, ArrowRight, Play, Trash2 } from 'lucide-react'
import { supabase, isSupabaseConfigured, deleteProject } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'

interface ProjectCloseoutReport {
  id: string
  project_id: string
  project_name: string
  generated_at: string
  reconciliation_type: string
  total_committed: number
  warning_items: number
  critical_items: number
}

async function getProjectCloseoutReports(): Promise<ProjectCloseoutReport[]> {
  const { data, error } = await supabase
    .from('reconciliation_reports')
    .select('*, projects(name)')
    .eq('reconciliation_type', 'project_closeout')
    .order('generated_at', { ascending: false })

  if (error) throw error

  return (data || []).map((report: any) => ({
    ...report,
    project_name: report.projects?.name || 'Unknown Project',
  }))
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

export default function ProjectCloseouts() {
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { data: reports, isLoading, refetch } = useQuery({
    queryKey: ['project-closeout-reports'],
    queryFn: getProjectCloseoutReports,
    enabled: isSupabaseConfigured,
  })

  async function handleDelete(projectId: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    if (!confirm('Are you sure you want to delete this project closeout report?')) {
      return
    }

    setDeletingId(projectId)
    try {
      await deleteProject(projectId)
      refetch()
    } catch (error) {
      console.error('Error deleting project:', error)
      alert('Failed to delete report. Please try again.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Project Closeouts</h1>
          <p className="mt-1 text-sm text-gray-500">
            Final reconciliation reports for completed projects
          </p>
        </div>
        <Link
          to="/run?mode=project-closeout"
          className="flex items-center px-6 py-3 bg-procore-blue text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm"
        >
          <Play className="w-5 h-5 mr-2" />
          Run Project Closeout
        </Link>
      </div>

      {/* Info Banner */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="flex items-start">
          <FolderCheck className="w-5 h-5 text-green-500 mt-0.5 mr-3" />
          <div>
            <h3 className="text-sm font-medium text-green-800">About Project Closeouts</h3>
            <p className="text-sm text-green-700 mt-1">
              Project Closeout reconciliation is the final financial review for a completed project.
              It ensures all financial records between Procore and QuickBooks are fully reconciled before project closure.
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
                  <div className="bg-green-100 rounded-lg p-3">
                    <FolderCheck className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {report.project_name}
                    </h3>
                    <p className="text-sm text-gray-500">
                      Closed out {formatDate(report.generated_at)}
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

                  <button
                    onClick={(e) => handleDelete(report.project_id, e)}
                    disabled={deletingId === report.project_id}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                    title="Delete report"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <ArrowRight className="w-5 h-5 text-gray-400" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card text-center py-12">
          <FolderCheck className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No Project Closeouts Yet</h3>
          <p className="text-gray-500 mt-1 mb-4">
            Run your first project closeout reconciliation to see reports here
          </p>
          <Link
            to="/run?mode=project-closeout"
            className="inline-flex items-center px-4 py-2 bg-procore-blue text-white rounded-lg hover:bg-blue-700"
          >
            <Play className="w-4 h-4 mr-2" />
            Run Project Closeout
          </Link>
        </div>
      )}
    </div>
  )
}
