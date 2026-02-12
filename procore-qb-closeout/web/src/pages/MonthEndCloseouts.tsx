import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import {
  Calendar,
  AlertTriangle,
  AlertCircle,
  ArrowRight,
  Play,
  Building2,
  Briefcase,
  CheckCircle,
  Lock,
  Loader2,
  Search,
} from 'lucide-react'
import { supabase, isSupabaseConfigured, getProjects, createWIPReport, Project } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'
import AIChat from '../components/AIChat'

interface MonthEndReport {
  id: string
  project_id: string
  generated_at: string
  reconciliation_type: string
  total_committed: number
  estimated_exposure: number
  warning_items: number
  critical_items: number
  reconciled_items: number
  procore_sub_invoiced: number | null
  qbo_sub_invoiced: number | null
  projects?: Project
}

type ViewMode = 'portfolio' | 'project'

function getUserId(): string {
  let userId = localStorage.getItem('closeout_user_id')
  if (!userId) {
    userId = 'user_' + Math.random().toString(36).substring(2, 15)
    localStorage.setItem('closeout_user_id', userId)
  }
  return userId
}

async function getMonthEndReports(): Promise<MonthEndReport[]> {
  const { data, error } = await supabase
    .from('reconciliation_reports')
    .select('*, projects(*)')
    .order('generated_at', { ascending: false })

  if (error) throw error
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

function getLastDayOfMonth(): string {
  const now = new Date()
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return lastDay.toISOString().split('T')[0]
}

export default function MonthEndCloseouts() {
  const navigate = useNavigate()
  const [viewMode, setViewMode] = useState<ViewMode>('portfolio')
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isClosingMonth, setIsClosingMonth] = useState(false)

  const { data: reports, isLoading: reportsLoading } = useQuery({
    queryKey: ['month-end-reports'],
    queryFn: getMonthEndReports,
    enabled: isSupabaseConfigured,
  })

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
    enabled: isSupabaseConfigured,
  })

  // Filter reports based on view mode and selected project
  const filteredReports = reports?.filter(r => {
    if (viewMode === 'project' && selectedProject) {
      return r.project_id === selectedProject
    }
    return true
  }) || []

  // Filter projects for search
  const filteredProjects = projects?.filter(p => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    return p.name.toLowerCase().includes(query) || (p.project_number && p.project_number.toLowerCase().includes(query))
  }) || []

  // Calculate portfolio totals
  const portfolioTotals = {
    totalCommitted: filteredReports.reduce((sum, r) => sum + (r.total_committed || 0), 0),
    totalExposure: filteredReports.reduce((sum, r) => sum + (r.estimated_exposure || 0), 0),
    totalWarnings: filteredReports.reduce((sum, r) => sum + (r.warning_items || 0), 0),
    totalCritical: filteredReports.reduce((sum, r) => sum + (r.critical_items || 0), 0),
    totalReconciled: filteredReports.reduce((sum, r) => sum + (r.reconciled_items || 0), 0),
    projectCount: new Set(filteredReports.map(r => r.project_id)).size,
  }

  // Check if all projects are fully reconciled (no warnings or critical items)
  const isFullyReconciled = portfolioTotals.totalWarnings === 0 && portfolioTotals.totalCritical === 0 && filteredReports.length > 0

  async function handleCloseMonth() {
    if (!isFullyReconciled || isClosingMonth) return

    const confirmed = confirm(
      `Are you sure you want to close the month?\n\n` +
      `This will generate a WIP (Work In Progress) report for ${formatMonthYear(new Date().toISOString())} ` +
      `with ${portfolioTotals.projectCount} project(s).\n\n` +
      `The WIP report will be available in the WIP Reports section.`
    )

    if (!confirmed) return

    setIsClosingMonth(true)
    try {
      // Build report data from current reconciliation reports
      const projectData = filteredReports.map(r => ({
        name: r.projects?.name || 'Unknown',
        projectId: r.project_id,
        contractValue: r.total_committed || 0,
        costToDate: r.procore_sub_invoiced || 0,
        billingToDate: r.qbo_sub_invoiced || 0,
        overUnderBilling: (r.qbo_sub_invoiced || 0) - (r.procore_sub_invoiced || 0),
        projectedGrossProfit: 0, // Would need more data to calculate
        percentComplete: r.total_committed > 0 ? (r.procore_sub_invoiced || 0) / r.total_committed : 0,
      }))

      const reportData = {
        projects: projectData,
        generatedFrom: 'month_end_reconciliation',
      }

      await createWIPReport(getLastDayOfMonth(), getUserId(), reportData)

      alert('Month closed successfully! WIP report has been generated.')
      navigate('/wip-reports')
    } catch (error: any) {
      console.error('Error closing month:', error)
      alert(`Failed to close month: ${error.message}`)
    } finally {
      setIsClosingMonth(false)
    }
  }

  const isLoading = reportsLoading || projectsLoading

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Month-End Reconciliation</h1>
          <p className="mt-1 text-sm text-gray-500">
            Reconciliation across all active "Course of Construction" projects
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <Link
            to="/run?mode=month-end"
            className="flex items-center px-6 py-3 bg-procore-blue text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm"
          >
            <Play className="w-5 h-5 mr-2" />
            Run Reconciliation
          </Link>
          <button
            onClick={handleCloseMonth}
            disabled={!isFullyReconciled || isClosingMonth}
            title={
              !isFullyReconciled
                ? 'All projects must be fully reconciled (no warnings or critical items) to close the month'
                : 'Generate WIP report and close the month'
            }
            className={`flex items-center px-6 py-3 font-medium rounded-lg shadow-sm ${
              isFullyReconciled
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {isClosingMonth ? (
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            ) : (
              <Lock className="w-5 h-5 mr-2" />
            )}
            Close Month
          </button>
        </div>
      </div>

      {/* View Toggle */}
      <div className="flex items-center justify-between bg-white p-4 rounded-lg border border-gray-200">
        <div className="flex items-center space-x-4">
          <span className="text-sm font-medium text-gray-700">View:</span>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            <button
              onClick={() => { setViewMode('portfolio'); setSelectedProject(null); }}
              className={`flex items-center px-4 py-2 text-sm font-medium ${
                viewMode === 'portfolio'
                  ? 'bg-procore-blue text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Briefcase className="w-4 h-4 mr-2" />
              Portfolio
            </button>
            <button
              onClick={() => setViewMode('project')}
              className={`flex items-center px-4 py-2 text-sm font-medium border-l border-gray-300 ${
                viewMode === 'project'
                  ? 'bg-procore-blue text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Building2 className="w-4 h-4 mr-2" />
              Project
            </button>
          </div>
        </div>

        {/* Reconciliation Status */}
        <div className="flex items-center space-x-2">
          {isFullyReconciled ? (
            <div className="flex items-center text-green-600">
              <CheckCircle className="w-5 h-5 mr-2" />
              <span className="text-sm font-medium">Fully Reconciled - Ready to Close Month</span>
            </div>
          ) : filteredReports.length > 0 ? (
            <div className="flex items-center text-yellow-600">
              <AlertTriangle className="w-5 h-5 mr-2" />
              <span className="text-sm font-medium">
                {portfolioTotals.totalWarnings + portfolioTotals.totalCritical} issue(s) need resolution
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Project Selector (when in Project view) */}
      {viewMode === 'project' && (
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-procore-blue focus:border-transparent"
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
            {filteredProjects.map((project) => (
              <button
                key={project.id}
                onClick={() => setSelectedProject(project.id)}
                className={`p-3 text-left rounded-lg border text-sm ${
                  selectedProject === project.id
                    ? 'border-procore-blue bg-blue-50 text-procore-blue'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                <p className="font-medium truncate">{project.name}</p>
                {project.project_number && (
                  <p className="text-xs text-gray-500">#{project.project_number}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Portfolio Summary (when in Portfolio view) */}
      {viewMode === 'portfolio' && filteredReports.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <div className="card text-center">
            <p className="text-sm text-gray-500">Projects</p>
            <p className="text-2xl font-semibold text-gray-900">{portfolioTotals.projectCount}</p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Total Committed</p>
            <p className="text-xl font-semibold text-gray-900">{formatCurrency(portfolioTotals.totalCommitted)}</p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Reconciled Items</p>
            <p className="text-2xl font-semibold text-green-600">{portfolioTotals.totalReconciled}</p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Warnings</p>
            <p className="text-2xl font-semibold text-yellow-600">{portfolioTotals.totalWarnings}</p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Critical</p>
            <p className="text-2xl font-semibold text-red-600">{portfolioTotals.totalCritical}</p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Total Exposure</p>
            <p className={`text-xl font-semibold ${portfolioTotals.totalExposure > 0 ? 'text-red-600' : 'text-gray-900'}`}>
              {formatCurrency(portfolioTotals.totalExposure)}
            </p>
          </div>
        </div>
      )}

      {/* Reports List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-procore-blue"></div>
        </div>
      ) : filteredReports.length > 0 ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {viewMode === 'portfolio' ? 'All Project Reconciliations' : 'Project Reconciliation History'}
          </h2>
          {filteredReports.map((report) => (
            <Link
              key={report.id}
              to={`/report/${report.id}`}
              className="block card hover:shadow-lg transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className={`rounded-lg p-3 ${
                    (report.warning_items || 0) + (report.critical_items || 0) === 0
                      ? 'bg-green-100'
                      : (report.critical_items || 0) > 0
                      ? 'bg-red-100'
                      : 'bg-yellow-100'
                  }`}>
                    {(report.warning_items || 0) + (report.critical_items || 0) === 0 ? (
                      <CheckCircle className="w-6 h-6 text-green-600" />
                    ) : (report.critical_items || 0) > 0 ? (
                      <AlertCircle className="w-6 h-6 text-red-600" />
                    ) : (
                      <AlertTriangle className="w-6 h-6 text-yellow-600" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {report.projects?.name || 'Unknown Project'}
                    </h3>
                    <p className="text-sm text-gray-500">
                      Reconciled {formatDate(report.generated_at)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-6">
                  <div className="text-right">
                    <p className="text-xs text-gray-500 uppercase">Committed</p>
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
                    {(report.reconciled_items || 0) > 0 && (
                      <div className="flex items-center text-green-600">
                        <CheckCircle className="w-4 h-4 mr-1" />
                        <span className="text-sm font-medium">{report.reconciled_items}</span>
                      </div>
                    )}
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
          <h3 className="text-lg font-medium text-gray-900">
            {viewMode === 'project' && selectedProject
              ? 'No Reconciliations for Selected Project'
              : 'No Month-End Reconciliations Yet'}
          </h3>
          <p className="text-gray-500 mt-1 mb-4">
            Run a reconciliation to see reports here
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

      {/* AI Chat */}
      <AIChat
        projectName="Portfolio Overview"
        contextData={{
          viewMode,
          portfolioTotals,
          projectCount: portfolioTotals.projectCount,
          isFullyReconciled,
        }}
      />
    </div>
  )
}
