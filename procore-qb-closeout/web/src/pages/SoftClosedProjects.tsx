import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  PauseCircle,
  ArrowRight,
  FileText,
  DollarSign,
  Trash2,
} from 'lucide-react'
import { getSoftClosedProjects, removeSoftClose, isSupabaseConfigured } from '../lib/supabase'

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function SoftClosedProjects() {
  const [removingId, setRemovingId] = useState<string | null>(null)

  const { data: softClosedProjects, isLoading, refetch } = useQuery({
    queryKey: ['soft-closed-projects'],
    queryFn: getSoftClosedProjects,
    enabled: isSupabaseConfigured,
  })

  async function handleRemoveSoftClose(projectId: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    if (!confirm('Are you sure you want to remove this project from soft closed status?')) {
      return
    }

    setRemovingId(projectId)
    try {
      await removeSoftClose(projectId)
      refetch()
    } catch (error) {
      console.error('Error removing soft close:', error)
      alert('Failed to remove soft close status. Please try again.')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Soft Closed Projects</h1>
        <p className="mt-1 text-sm text-gray-500">
          Projects that have reached substantial completion but have outstanding financial tails
        </p>
      </div>

      {/* Info Banner */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-start">
          <PauseCircle className="w-5 h-5 text-yellow-500 mt-0.5 mr-3" />
          <div>
            <h3 className="text-sm font-medium text-yellow-800">What is Soft Close?</h3>
            <p className="text-sm text-yellow-700 mt-1">
              Soft Closed projects are substantially complete but still have pending financials.
              This may include open accounts payable, open accounts receivable, or invoices that
              subcontractors still need to submit. Once all financials are settled, projects can
              move to Hard Close.
            </p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {softClosedProjects && softClosedProjects.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="card text-center">
            <p className="text-sm text-gray-500">Soft Closed Projects</p>
            <p className="text-2xl font-semibold text-yellow-600">{softClosedProjects.length}</p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Total Open APs</p>
            <p className="text-2xl font-semibold text-orange-600">
              {softClosedProjects.reduce((sum, p) => sum + (p.open_aps || 0), 0)}
            </p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Total Open ARs</p>
            <p className="text-2xl font-semibold text-blue-600">
              {softClosedProjects.reduce((sum, p) => sum + (p.open_ars || 0), 0)}
            </p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Pending Invoices</p>
            <p className="text-2xl font-semibold text-purple-600">
              {softClosedProjects.reduce((sum, p) => sum + (p.pending_invoices || 0), 0)}
            </p>
          </div>
        </div>
      )}

      {/* Projects List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-procore-blue"></div>
        </div>
      ) : softClosedProjects && softClosedProjects.length > 0 ? (
        <div className="space-y-4">
          {softClosedProjects.map((softClosed) => (
            <Link
              key={softClosed.id}
              to={`/project/${softClosed.project_id}`}
              className="block card hover:shadow-lg transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="bg-yellow-100 rounded-lg p-3">
                    <PauseCircle className="w-6 h-6 text-yellow-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {softClosed.projects?.name || 'Unknown Project'}
                    </h3>
                    <p className="text-sm text-gray-500">
                      Soft closed {formatDate(softClosed.soft_closed_at)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-6">
                  {/* Outstanding Items */}
                  <div className="flex items-center space-x-4 text-sm">
                    {(softClosed.open_aps || 0) > 0 && (
                      <div className="flex items-center text-orange-600">
                        <DollarSign className="w-4 h-4 mr-1" />
                        <span>{softClosed.open_aps} Open APs</span>
                      </div>
                    )}
                    {(softClosed.open_ars || 0) > 0 && (
                      <div className="flex items-center text-blue-600">
                        <DollarSign className="w-4 h-4 mr-1" />
                        <span>{softClosed.open_ars} Open ARs</span>
                      </div>
                    )}
                    {(softClosed.pending_invoices || 0) > 0 && (
                      <div className="flex items-center text-purple-600">
                        <FileText className="w-4 h-4 mr-1" />
                        <span>{softClosed.pending_invoices} Pending</span>
                      </div>
                    )}
                  </div>

                  {softClosed.notes && (
                    <div className="max-w-xs text-sm text-gray-500 truncate" title={softClosed.notes}>
                      {softClosed.notes}
                    </div>
                  )}

                  <button
                    onClick={(e) => handleRemoveSoftClose(softClosed.project_id, e)}
                    disabled={removingId === softClosed.project_id}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                    title="Remove from Soft Closed"
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
          <PauseCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No Soft Closed Projects</h3>
          <p className="text-gray-500 mt-1 mb-4">
            Projects that reach substantial completion can be soft closed from the Project Closeout page
          </p>
          <Link
            to="/project-closeouts"
            className="inline-flex items-center px-4 py-2 bg-procore-blue text-white rounded-lg hover:bg-blue-700"
          >
            Go to Project Closeouts
          </Link>
        </div>
      )}
    </div>
  )
}
