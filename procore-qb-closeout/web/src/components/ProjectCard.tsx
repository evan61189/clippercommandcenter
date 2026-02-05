import { Link } from 'react-router-dom'
import { Building2, AlertTriangle, AlertCircle, ArrowRight } from 'lucide-react'
import { formatCurrency } from '../lib/utils'
import type { Project } from '../lib/supabase'

interface ProjectCardProps {
  project: Project | {
    id: string
    name: string
    project_number: string | null
    status: string
    total_committed?: number
    estimated_exposure?: number
    warning_items?: number
    critical_items?: number
  }
  isDemo?: boolean
}

export default function ProjectCard({ project, isDemo }: ProjectCardProps) {
  const totalCommitted = 'total_committed' in project ? project.total_committed : 0
  const estimatedExposure = 'estimated_exposure' in project ? project.estimated_exposure : 0
  const warningItems = 'warning_items' in project ? project.warning_items : 0
  const criticalItems = 'critical_items' in project ? project.critical_items : 0

  return (
    <div className="card hover:shadow-lg transition-shadow">
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
        <span
          className={`badge ${
            project.status === 'active' ? 'badge-info' : 'bg-gray-100 text-gray-700'
          }`}
        >
          {project.status}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-gray-500 uppercase">Total Committed</p>
          <p className="text-lg font-semibold text-gray-900">
            {formatCurrency(totalCommitted)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase">Exposure</p>
          <p className={`text-lg font-semibold ${estimatedExposure && estimatedExposure > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {formatCurrency(estimatedExposure)}
          </p>
        </div>
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
