import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Building2, AlertTriangle, AlertCircle, DollarSign, CheckCircle } from 'lucide-react'
import { getProjects, getDashboardStats } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'
import StatsCard from '../components/StatsCard'
import ProjectCard from '../components/ProjectCard'

export default function Dashboard() {
  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
  })

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: getDashboardStats,
  })

  if (projectsLoading || statsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-procore-blue"></div>
      </div>
    )
  }

  // If no projects, show demo data
  const showDemo = !projects || projects.length === 0

  const demoProjects = [
    {
      id: 'demo-1',
      name: 'Corporate Office Buildout - Phase 2',
      project_number: '2024-001',
      status: 'active',
      total_committed: 491000,
      estimated_exposure: 15500,
      warning_items: 5,
      critical_items: 2,
    },
    {
      id: 'demo-2',
      name: 'Tech Campus Building A',
      project_number: '2024-002',
      status: 'active',
      total_committed: 2450000,
      estimated_exposure: 45000,
      warning_items: 8,
      critical_items: 1,
    },
  ]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Financial Closeout Dashboard
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Overview of project reconciliation status and open items
        </p>
      </div>

      {/* Demo Banner */}
      {showDemo && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center">
            <AlertCircle className="w-5 h-5 text-blue-500 mr-2" />
            <p className="text-sm text-blue-700">
              <strong>Demo Mode:</strong> Connect to Supabase to see real data.
              Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.
            </p>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard
          title="Active Projects"
          value={showDemo ? '2' : String(stats?.projectCount || 0)}
          icon={Building2}
          color="blue"
        />
        <StatsCard
          title="Open Items"
          value={showDemo ? '12' : String(stats?.openItemsCount || 0)}
          icon={CheckCircle}
          color="yellow"
        />
        <StatsCard
          title="Warnings"
          value={showDemo ? '13' : String(stats?.totalWarnings || 0)}
          icon={AlertTriangle}
          color="yellow"
        />
        <StatsCard
          title="Critical Issues"
          value={showDemo ? '3' : String(stats?.totalCritical || 0)}
          icon={AlertCircle}
          color="red"
        />
      </div>

      {/* Total Exposure */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900">
              Total Estimated Exposure
            </h3>
            <p className="text-sm text-gray-500">
              Combined financial risk across all projects
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-red-600">
              {formatCurrency(showDemo ? 60500 : stats?.totalExposure || 0)}
            </p>
          </div>
        </div>
      </div>

      {/* Projects List */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Projects
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {showDemo ? (
            demoProjects.map((project) => (
              <ProjectCard key={project.id} project={project} isDemo />
            ))
          ) : (
            projects?.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
