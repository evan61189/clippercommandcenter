import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, AlertTriangle, AlertCircle, ArrowRight, Trash2, DollarSign } from 'lucide-react'
import { formatCurrency } from '../lib/utils'
import { deleteProject } from '../lib/supabase'
import type { ProjectWithReport } from '../lib/supabase'

interface ProjectCardProps {
  project: ProjectWithReport
  isDemo?: boolean
  onDeleted?: () => void
}

export default function ProjectCard({ project, isDemo, onDeleted }: ProjectCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const report = project.latest_report
  const totalCommitted = report?.total_committed || 0
  const warningItems = report?.warning_items || 0
  const criticalItems = report?.critical_items || 0
  const reportId = report?.id

  async function handleDelete() {
    setIsDeleting(true)
    try {
      await deleteProject(project.id)
      onDeleted?.()
    } catch (error) {
      console.error('Error deleting project:', error)
      alert('Failed to delete report. Please try again.')
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  return (
    <div className="card hover:shadow-lg transition-shadow relative">
      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 bg-white/95 rounded-lg z-10 flex flex-col items-center justify-center p-6">
          <Trash2 className="w-10 h-10 text-red-500 mb-3" />
          <h4 className="font-semibold text-gray-900 text-center mb-2">Delete this report?</h4>
          <p className="text-sm text-gray-500 text-center mb-4">
            This will permanently delete the reconciliation report and all associated data.
          </p>
          <div className="flex space-x-3">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              disabled={isDeleting}
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-4">
          <div className="bg-procore-blue/10 rounded-lg p-3">
            <Building2 className="w-6 h-6 text-procore-blue" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{project.name}</h3>
            <p className="text-sm text-gray-500">
              {project.project_number || 'No project number'}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {!isDemo && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
              title="Delete report"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <span
            className={`badge ${
              project.status === 'active' ? 'badge-info' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {project.status}
          </span>
        </div>
      </div>

      {/* Metrics row */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        {/* Total Committed */}
        {reportId && !isDemo ? (
          <Link
            to={`/report/${reportId}`}
            className="group rounded-lg p-2 hover:bg-blue-50 transition-colors"
          >
            <p className="text-xs text-gray-500 uppercase flex items-center">
              <DollarSign className="w-3 h-3 mr-0.5" />
              Committed
            </p>
            <p className="text-lg font-semibold text-gray-900 group-hover:text-procore-blue">
              {formatCurrency(totalCommitted)}
            </p>
          </Link>
        ) : (
          <div className="rounded-lg p-2">
            <p className="text-xs text-gray-500 uppercase flex items-center">
              <DollarSign className="w-3 h-3 mr-0.5" />
              Committed
            </p>
            <p className="text-lg font-semibold text-gray-900">
              {report ? formatCurrency(totalCommitted) : '--'}
            </p>
          </div>
        )}

        {/* Warnings */}
        {reportId && !isDemo && warningItems > 0 ? (
          <Link
            to={`/report/${reportId}?filter=warning`}
            className="group rounded-lg p-2 hover:bg-yellow-50 transition-colors"
          >
            <p className="text-xs text-gray-500 uppercase flex items-center">
              <AlertTriangle className="w-3 h-3 mr-0.5 text-yellow-500" />
              Warnings
            </p>
            <p className="text-lg font-semibold text-yellow-600 group-hover:text-yellow-700">
              {warningItems}
            </p>
          </Link>
        ) : (
          <div className="rounded-lg p-2">
            <p className="text-xs text-gray-500 uppercase flex items-center">
              <AlertTriangle className="w-3 h-3 mr-0.5 text-yellow-500" />
              Warnings
            </p>
            <p className="text-lg font-semibold text-gray-400">
              {report ? warningItems : '--'}
            </p>
          </div>
        )}

        {/* Critical Issues */}
        {reportId && !isDemo && criticalItems > 0 ? (
          <Link
            to={`/report/${reportId}?filter=critical`}
            className="group rounded-lg p-2 hover:bg-red-50 transition-colors"
          >
            <p className="text-xs text-gray-500 uppercase flex items-center">
              <AlertCircle className="w-3 h-3 mr-0.5 text-red-500" />
              Critical
            </p>
            <p className="text-lg font-semibold text-red-600 group-hover:text-red-700">
              {criticalItems}
            </p>
          </Link>
        ) : (
          <div className="rounded-lg p-2">
            <p className="text-xs text-gray-500 uppercase flex items-center">
              <AlertCircle className="w-3 h-3 mr-0.5 text-red-500" />
              Critical
            </p>
            <p className="text-lg font-semibold text-gray-400">
              {report ? criticalItems : '--'}
            </p>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-end pt-3 border-t border-gray-100">
        {isDemo ? (
          <span className="text-sm text-gray-400 flex items-center">
            Demo Data
          </span>
        ) : (
          <Link
            to={reportId ? `/report/${reportId}` : `/project/${project.id}`}
            className="text-sm text-procore-blue hover:text-blue-700 flex items-center"
          >
            View Full Report
            <ArrowRight className="w-4 h-4 ml-1" />
          </Link>
        )}
      </div>
    </div>
  )
}
