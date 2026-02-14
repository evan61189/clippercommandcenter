import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, AlertTriangle, AlertCircle, ArrowRight, Trash2 } from 'lucide-react'
import { formatCurrency } from '../lib/utils'
import { deleteProject } from '../lib/supabase'
import type { Project } from '../lib/supabase'

interface ProjectCardProps {
  project: Project | {
    id: string
    name: string
    project_number: string | null
    status: string
    total_committed?: number
    warning_items?: number
    critical_items?: number
  }
  isDemo?: boolean
  onDeleted?: () => void
}

export default function ProjectCard({ project, isDemo, onDeleted }: ProjectCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const totalCommitted = 'total_committed' in project ? project.total_committed : 0
  const warningItems = 'warning_items' in project ? project.warning_items : 0
  const criticalItems = 'critical_items' in project ? project.critical_items : 0

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

      <div className="mt-4">
        <p className="text-xs text-gray-500 uppercase">Total Committed</p>
        <p className="text-lg font-semibold text-gray-900">
          {formatCurrency(totalCommitted)}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between pt-4 border-t border-gray-100">
        <div className="flex items-center space-x-4">
          {warningItems && warningItems > 0 && (
            <div className="flex items-center text-yellow-600">
              <AlertTriangle className="w-4 h-4 mr-1" />
              <span className="text-sm font-medium">{warningItems}</span>
            </div>
          )}
          {criticalItems && criticalItems > 0 && (
            <div className="flex items-center text-red-600">
              <AlertCircle className="w-4 h-4 mr-1" />
              <span className="text-sm font-medium">{criticalItems}</span>
            </div>
          )}
        </div>
        {isDemo ? (
          <span className="text-sm text-gray-400 flex items-center">
            Demo Data
          </span>
        ) : (
          <Link
            to={`/project/${project.id}`}
            className="text-sm text-procore-blue hover:text-blue-700 flex items-center"
          >
            View Details
            <ArrowRight className="w-4 h-4 ml-1" />
          </Link>
        )}
      </div>
    </div>
  )
}
