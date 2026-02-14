import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, FileText, Calendar, AlertCircle } from 'lucide-react'
import { getProject, getReportsForProject } from '../lib/supabase'
import { formatCurrency, formatDateTime } from '../lib/utils'

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>()

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  })

  const { data: reports, isLoading: reportsLoading } = useQuery({
    queryKey: ['project-reports', projectId],
    queryFn: () => getReportsForProject(projectId!),
    enabled: !!projectId,
  })

  if (projectLoading || reportsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-procore-blue"></div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900">Project not found</h2>
        <Link to="/" className="text-procore-blue hover:underline mt-2 inline-block">
          Return to Dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        to="/"
        className="flex items-center text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Dashboard
      </Link>

      {/* Project Header */}
      <div className="card">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
            <p className="text-gray-500">
              {project.project_number && `#${project.project_number}`}
              {project.address && ` · ${project.address}`}
            </p>
          </div>
          <span
            className={`badge ${
              project.status === 'active' ? 'badge-info' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {project.status}
          </span>
        </div>
      </div>

      {/* Reports List */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Reconciliation Reports
        </h2>

        {reports && reports.length > 0 ? (
          <div className="space-y-4">
            {reports.map((report) => (
              <Link
                key={report.id}
                to={`/report/${report.id}`}
                className="card block hover:shadow-lg transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="bg-gray-100 rounded-lg p-3">
                      <FileText className="w-6 h-6 text-gray-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        Closeout Report
                      </p>
                      <p className="text-sm text-gray-500 flex items-center">
                        <Calendar className="w-4 h-4 mr-1" />
                        {formatDateTime(report.generated_at)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-6 text-sm">
                    <div className="text-center">
                      <p className="text-gray-500">Committed</p>
                      <p className="font-semibold">
                        {formatCurrency(report.total_committed)}
                      </p>
                    </div>
                    <div className="flex space-x-2">
                      {report.warning_items > 0 && (
                        <span className="badge badge-warning">
                          {report.warning_items} warnings
                        </span>
                      )}
                      {report.critical_items > 0 && (
                        <span className="badge badge-critical">
                          {report.critical_items} critical
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="card text-center py-12">
            <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900">No reports yet</h3>
            <p className="text-gray-500 mt-1">
              Run the CLI tool to generate reconciliation reports for this project.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
