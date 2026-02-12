import { useState, useMemo } from 'react'
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
  Clock,
} from 'lucide-react'
import { supabase, isSupabaseConfigured, createWIPReport } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'
import AIChat from '../components/AIChat'

interface ProcoreProject {
  id: number
  name: string
  project_number: string
  status: string
  stage: string
}

interface ReconciliationReport {
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

async function fetchProcoreProjects(): Promise<ProcoreProject[]> {
  const userId = getUserId()
  const response = await fetch('/.netlify/functions/procore-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'getProjects', userId }),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load projects')
  }
  return data || []
}

async function getReconciliationReports(): Promise<ReconciliationReport[]> {
  const { data, error } = await supabase
    .from('reconciliation_reports')
    .select('*')
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
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isClosingMonth, setIsClosingMonth] = useState(false)

  // Fetch projects from Procore
  const { data: allProjects, isLoading: projectsLoading, error: projectsError } = useQuery({
    queryKey: ['procore-projects'],
    queryFn: fetchProcoreProjects,
  })

  // Fetch existing reconciliation reports
  const { data: reports, isLoading: reportsLoading } = useQuery({
    queryKey: ['reconciliation-reports'],
    queryFn: getReconciliationReports,
    enabled: isSupabaseConfigured,
  })

  // Filter projects to only "Course of Construction"
  const cocProjects = useMemo(() => {
    if (!allProjects) return []
    return allProjects.filter(p => {
      const projectStatus = (p.status || '').toLowerCase()
      const projectStage = (p.stage || '').toLowerCase()
      return projectStatus.includes('course of construction') ||
             projectStage.includes('course of construction')
    })
  }, [allProjects])

  // Apply search filter
  const filteredProjects = useMemo(() => {
    return cocProjects.filter(p => {
      if (!searchQuery.trim()) return true
      const query = searchQuery.toLowerCase()
      return p.name.toLowerCase().includes(query) ||
             (p.project_number && p.project_number.toLowerCase().includes(query))
    })
  }, [cocProjects, searchQuery])

  // Build project display list with reconciliation status
  const projectsWithStatus = useMemo(() => {
    return filteredProjects.map(project => {
      // Find report by looking for project ID match (reports store project as string UUID)
      // We need to match by name since Procore IDs and our UUIDs differ
      const matchingReport = reports?.find(r => {
        // Check if project name is stored somewhere or if we can match
        // For now, we'll match by the project_id field if it contains the procore id
        return r.project_id === String(project.id)
      })

      return {
        ...project,
        report: matchingReport,
        isReconciled: matchingReport &&
          (matchingReport.warning_items || 0) === 0 &&
          (matchingReport.critical_items || 0) === 0,
        hasReport: !!matchingReport,
      }
    })
  }, [filteredProjects, reports])

  // Filter based on view mode
  const displayProjects = viewMode === 'project' && selectedProjectId
    ? projectsWithStatus.filter(p => p.id === selectedProjectId)
    : projectsWithStatus

  // Calculate portfolio totals
  const portfolioTotals = useMemo(() => {
    const projectsWithReports = projectsWithStatus.filter(p => p.hasReport)
    return {
      totalProjects: cocProjects.length,
      reconciledProjects: projectsWithReports.filter(p => p.isReconciled).length,
      projectsWithIssues: projectsWithReports.filter(p => !p.isReconciled).length,
      notReconciledProjects: projectsWithStatus.filter(p => !p.hasReport).length,
      totalCommitted: projectsWithReports.reduce((sum, p) => sum + (p.report?.total_committed || 0), 0),
      totalExposure: projectsWithReports.reduce((sum, p) => sum + (p.report?.estimated_exposure || 0), 0),
      totalWarnings: projectsWithReports.reduce((sum, p) => sum + (p.report?.warning_items || 0), 0),
      totalCritical: projectsWithReports.reduce((sum, p) => sum + (p.report?.critical_items || 0), 0),
    }
  }, [cocProjects, projectsWithStatus])

  // Check if all projects are fully reconciled
  const isFullyReconciled = portfolioTotals.notReconciledProjects === 0 &&
    portfolioTotals.projectsWithIssues === 0 &&
    portfolioTotals.totalProjects > 0

  async function handleCloseMonth() {
    if (!isFullyReconciled || isClosingMonth) return

    const confirmed = confirm(
      `Are you sure you want to close the month?\n\n` +
      `This will generate a WIP (Work In Progress) report for ${formatMonthYear(new Date().toISOString())} ` +
      `with ${portfolioTotals.totalProjects} project(s).\n\n` +
      `The WIP report will be available in the WIP Reports section.`
    )

    if (!confirmed) return

    setIsClosingMonth(true)
    try {
      const projectData = projectsWithStatus
        .filter(p => p.hasReport)
        .map(p => ({
          name: p.name,
          projectId: String(p.id),
          contractValue: p.report?.total_committed || 0,
          costToDate: p.report?.procore_sub_invoiced || 0,
          billingToDate: p.report?.qbo_sub_invoiced || 0,
          overUnderBilling: (p.report?.qbo_sub_invoiced || 0) - (p.report?.procore_sub_invoiced || 0),
          projectedGrossProfit: 0,
          percentComplete: p.report?.total_committed && p.report.total_committed > 0
            ? (p.report?.procore_sub_invoiced || 0) / p.report.total_committed
            : 0,
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

  if (projectsError) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Month-End Reconciliation</h1>
          <p className="mt-1 text-sm text-gray-500">
            Reconciliation across all active "Course of Construction" projects
          </p>
        </div>
        <div className="card text-center py-12">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">Failed to Load Projects</h3>
          <p className="text-gray-500 mt-1 mb-4">{(projectsError as Error).message}</p>
          <p className="text-sm text-gray-400">
            Please ensure Procore is connected in Settings.
          </p>
        </div>
      </div>
    )
  }

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
                ? 'All projects must be reconciled with no warnings or critical items to close the month'
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
              onClick={() => { setViewMode('portfolio'); setSelectedProjectId(null); }}
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
          ) : portfolioTotals.totalProjects > 0 ? (
            <div className="flex items-center text-yellow-600">
              <AlertTriangle className="w-5 h-5 mr-2" />
              <span className="text-sm font-medium">
                {portfolioTotals.notReconciledProjects > 0
                  ? `${portfolioTotals.notReconciledProjects} project(s) not reconciled`
                  : `${portfolioTotals.totalWarnings + portfolioTotals.totalCritical} issue(s) need resolution`
                }
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
                onClick={() => setSelectedProjectId(project.id)}
                className={`p-3 text-left rounded-lg border text-sm ${
                  selectedProjectId === project.id
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
      {viewMode === 'portfolio' && !isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="card text-center">
            <p className="text-sm text-gray-500">Total Projects</p>
            <p className="text-2xl font-semibold text-gray-900">{portfolioTotals.totalProjects}</p>
            <p className="text-xs text-gray-400">Course of Construction</p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Reconciled</p>
            <p className="text-2xl font-semibold text-green-600">{portfolioTotals.reconciledProjects}</p>
            <p className="text-xs text-gray-400">No issues</p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Has Issues</p>
            <p className="text-2xl font-semibold text-yellow-600">{portfolioTotals.projectsWithIssues}</p>
            <p className="text-xs text-gray-400">Needs attention</p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Not Reconciled</p>
            <p className="text-2xl font-semibold text-gray-400">{portfolioTotals.notReconciledProjects}</p>
            <p className="text-xs text-gray-400">Needs reconciliation</p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Total Exposure</p>
            <p className={`text-xl font-semibold ${portfolioTotals.totalExposure > 0 ? 'text-red-600' : 'text-gray-900'}`}>
              {formatCurrency(portfolioTotals.totalExposure)}
            </p>
          </div>
        </div>
      )}

      {/* Projects List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-procore-blue"></div>
        </div>
      ) : displayProjects.length > 0 ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {viewMode === 'portfolio' ? 'All Course of Construction Projects' : 'Selected Project'}
          </h2>
          {displayProjects.map((project) => (
            <div
              key={project.id}
              className="block card hover:shadow-lg transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className={`rounded-lg p-3 ${
                    !project.hasReport
                      ? 'bg-gray-100'
                      : project.isReconciled
                      ? 'bg-green-100'
                      : (project.report?.critical_items || 0) > 0
                      ? 'bg-red-100'
                      : 'bg-yellow-100'
                  }`}>
                    {!project.hasReport ? (
                      <Clock className="w-6 h-6 text-gray-400" />
                    ) : project.isReconciled ? (
                      <CheckCircle className="w-6 h-6 text-green-600" />
                    ) : (project.report?.critical_items || 0) > 0 ? (
                      <AlertCircle className="w-6 h-6 text-red-600" />
                    ) : (
                      <AlertTriangle className="w-6 h-6 text-yellow-600" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{project.name}</h3>
                    <p className="text-sm text-gray-500">
                      {project.project_number && `#${project.project_number} • `}
                      {project.hasReport
                        ? `Reconciled ${formatDate(project.report!.generated_at)}`
                        : 'Not reconciled yet'
                      }
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-6">
                  {project.hasReport ? (
                    <>
                      <div className="text-right">
                        <p className="text-xs text-gray-500 uppercase">Committed</p>
                        <p className="text-lg font-semibold text-gray-900">
                          {formatCurrency(project.report?.total_committed || 0)}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-xs text-gray-500 uppercase">Exposure</p>
                        <p className={`text-lg font-semibold ${(project.report?.estimated_exposure || 0) > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                          {formatCurrency(project.report?.estimated_exposure || 0)}
                        </p>
                      </div>

                      <div className="flex items-center space-x-3">
                        {(project.report?.reconciled_items || 0) > 0 && (
                          <div className="flex items-center text-green-600">
                            <CheckCircle className="w-4 h-4 mr-1" />
                            <span className="text-sm font-medium">{project.report?.reconciled_items}</span>
                          </div>
                        )}
                        {(project.report?.warning_items || 0) > 0 && (
                          <div className="flex items-center text-yellow-600">
                            <AlertTriangle className="w-4 h-4 mr-1" />
                            <span className="text-sm font-medium">{project.report?.warning_items}</span>
                          </div>
                        )}
                        {(project.report?.critical_items || 0) > 0 && (
                          <div className="flex items-center text-red-600">
                            <AlertCircle className="w-4 h-4 mr-1" />
                            <span className="text-sm font-medium">{project.report?.critical_items}</span>
                          </div>
                        )}
                      </div>

                      <Link
                        to={`/report/${project.report?.id}`}
                        className="flex items-center text-procore-blue hover:text-blue-700"
                      >
                        <span className="text-sm font-medium mr-1">View Report</span>
                        <ArrowRight className="w-5 h-5" />
                      </Link>
                    </>
                  ) : (
                    <Link
                      to={`/run?mode=month-end&projectId=${project.id}`}
                      className="flex items-center px-4 py-2 bg-procore-blue text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Run Reconciliation
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card text-center py-12">
          <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">
            {cocProjects.length === 0
              ? 'No Projects in Course of Construction'
              : 'No Projects Match Search'
            }
          </h3>
          <p className="text-gray-500 mt-1 mb-4">
            {cocProjects.length === 0
              ? 'Connect to Procore to see projects in "Course of Construction" status'
              : 'Try adjusting your search query'
            }
          </p>
        </div>
      )}

      {/* AI Chat */}
      <AIChat
        projectName="Portfolio Overview"
        contextData={{
          viewMode,
          portfolioTotals,
          projectCount: portfolioTotals.totalProjects,
          isFullyReconciled,
        }}
      />
    </div>
  )
}
