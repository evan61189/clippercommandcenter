import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
  RefreshCw,
  XCircle,
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
type ReconciliationStatus = 'idle' | 'fetching_procore' | 'reconciling' | 'complete' | 'error'

interface ProjectReconciliationState {
  status: ReconciliationStatus
  error?: string
  report?: ReconciliationReport
}

// Convert a Procore numeric ID to a deterministic UUID for database storage
// The DB project_id column is UUID type, but Procore IDs are large numbers
function procoreIdToUUID(procoreId: number): string {
  const hex = procoreId.toString(16).padStart(32, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

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
  const queryClient = useQueryClient()
  const [viewMode, setViewMode] = useState<ViewMode>('portfolio')
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isClosingMonth, setIsClosingMonth] = useState(false)
  const [isRunningAll, setIsRunningAll] = useState(false)
  const [reconciliationStates, setReconciliationStates] = useState<Map<number, ProjectReconciliationState>>(new Map())
  const [currentProjectIndex, setCurrentProjectIndex] = useState<number>(-1)

  const userId = getUserId()

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
      const matchingReport = reports?.find(r => r.project_id === procoreIdToUUID(project.id))
      const reconciliationState = reconciliationStates.get(project.id)

      return {
        ...project,
        report: reconciliationState?.report || matchingReport,
        isReconciled: (reconciliationState?.report || matchingReport) &&
          ((reconciliationState?.report || matchingReport)?.warning_items || 0) === 0 &&
          ((reconciliationState?.report || matchingReport)?.critical_items || 0) === 0,
        hasReport: !!(reconciliationState?.report || matchingReport),
        reconciliationState,
      }
    })
  }, [filteredProjects, reports, reconciliationStates])

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
      totalWarnings: projectsWithReports.reduce((sum, p) => sum + (p.report?.warning_items || 0), 0),
      totalCritical: projectsWithReports.reduce((sum, p) => sum + (p.report?.critical_items || 0), 0),
    }
  }, [cocProjects, projectsWithStatus])

  // Check if all projects are fully reconciled
  const isFullyReconciled = portfolioTotals.notReconciledProjects === 0 &&
    portfolioTotals.projectsWithIssues === 0 &&
    portfolioTotals.totalProjects > 0

  // Run reconciliation for a single project
  async function runReconciliationForProject(project: ProcoreProject): Promise<ReconciliationReport | null> {
    // Update state to fetching procore
    setReconciliationStates(prev => new Map(prev).set(project.id, { status: 'fetching_procore' }))

    try {
      // Fetch Procore data for this project
      const procoreResponse = await fetch('/.netlify/functions/procore-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getFullProjectData',
          projectId: project.id,
          userId,
        }),
      })

      const procoreData = await procoreResponse.json()
      if (!procoreResponse.ok) {
        throw new Error(procoreData.error || 'Failed to fetch Procore data')
      }

      // Update state to reconciling
      setReconciliationStates(prev => new Map(prev).set(project.id, { status: 'reconciling' }))

      // Run reconciliation - use a deterministic UUID so the DB save succeeds
      const projectId = procoreIdToUUID(project.id)
      const reconResponse = await fetch('/.netlify/functions/run-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          procoreData,
          projectId,
          userId,
        }),
      })

      const reconText = await reconResponse.text()
      let reconResult: any
      try {
        reconResult = JSON.parse(reconText)
      } catch {
        if (reconText.includes('<HTML') || reconText.includes('<!DOCTYPE')) {
          throw new Error('Reconciliation timed out. The server took too long to respond. Please try again.')
        }
        throw new Error(`Server returned an unexpected response. Please try again.`)
      }
      if (!reconResponse.ok) {
        throw new Error(reconResult.error || 'Reconciliation failed')
      }

      // Create a report object from the result
      // The backend returns fields directly on the report object (snake_case), not nested under "summary"
      const report: ReconciliationReport = {
        id: reconResult.id || projectId,
        project_id: projectId,
        generated_at: reconResult.generated_at || new Date().toISOString(),
        reconciliation_type: 'month_end',
        total_committed: reconResult.total_committed || 0,
        estimated_exposure: 0,
        warning_items: reconResult.warning_items || 0,
        critical_items: reconResult.critical_items || 0,
        reconciled_items: reconResult.reconciled_items || 0,
        procore_sub_invoiced: reconResult.procore_sub_invoiced ?? null,
        qbo_sub_invoiced: reconResult.qbo_sub_invoiced ?? null,
      }

      // Update state to complete
      setReconciliationStates(prev => new Map(prev).set(project.id, { status: 'complete', report }))

      return report
    } catch (error: any) {
      // Update state to error
      setReconciliationStates(prev => new Map(prev).set(project.id, { status: 'error', error: error.message }))
      return null
    }
  }

  // Run reconciliation for all projects
  async function handleRunAllReconciliations() {
    if (isRunningAll || cocProjects.length === 0) return

    setIsRunningAll(true)
    setReconciliationStates(new Map())

    try {
      for (let i = 0; i < cocProjects.length; i++) {
        setCurrentProjectIndex(i)
        await runReconciliationForProject(cocProjects[i])
      }

      // Refresh the reports data
      await queryClient.invalidateQueries({ queryKey: ['reconciliation-reports'] })
    } finally {
      setIsRunningAll(false)
      setCurrentProjectIndex(-1)
    }
  }

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

  // Get status icon for a project during batch reconciliation
  function getProjectStatusIcon(project: typeof projectsWithStatus[0]) {
    const state = project.reconciliationState

    if (state?.status === 'fetching_procore') {
      return <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
    }
    if (state?.status === 'reconciling') {
      return <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
    }
    if (state?.status === 'error') {
      return <XCircle className="w-6 h-6 text-red-500" />
    }
    if (state?.status === 'complete' || project.hasReport) {
      if (project.isReconciled) {
        return <CheckCircle className="w-6 h-6 text-green-600" />
      }
      if ((project.report?.critical_items || 0) > 0) {
        return <AlertCircle className="w-6 h-6 text-red-600" />
      }
      return <AlertTriangle className="w-6 h-6 text-yellow-600" />
    }
    return <Clock className="w-6 h-6 text-gray-400" />
  }

  function getProjectStatusBg(project: typeof projectsWithStatus[0]) {
    const state = project.reconciliationState

    if (state?.status === 'fetching_procore' || state?.status === 'reconciling') {
      return 'bg-blue-100'
    }
    if (state?.status === 'error') {
      return 'bg-red-100'
    }
    if (!project.hasReport) {
      return 'bg-gray-100'
    }
    if (project.isReconciled) {
      return 'bg-green-100'
    }
    if ((project.report?.critical_items || 0) > 0) {
      return 'bg-red-100'
    }
    return 'bg-yellow-100'
  }

  function getProjectStatusText(project: typeof projectsWithStatus[0]) {
    const state = project.reconciliationState

    if (state?.status === 'fetching_procore') {
      return 'Fetching Procore data...'
    }
    if (state?.status === 'reconciling') {
      return 'Running reconciliation...'
    }
    if (state?.status === 'error') {
      return `Error: ${state.error}`
    }
    if (project.hasReport) {
      return `Reconciled ${formatDate(project.report!.generated_at)}`
    }
    return 'Not reconciled yet'
  }

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
          <button
            onClick={handleRunAllReconciliations}
            disabled={isRunningAll || cocProjects.length === 0}
            className={`flex items-center px-6 py-3 font-medium rounded-lg shadow-sm ${
              isRunningAll || cocProjects.length === 0
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-procore-blue text-white hover:bg-blue-700'
            }`}
          >
            {isRunningAll ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Reconciling {currentProjectIndex + 1}/{cocProjects.length}...
              </>
            ) : (
              <>
                <Play className="w-5 h-5 mr-2" />
                Run All Reconciliations
              </>
            )}
          </button>
          <button
            onClick={handleCloseMonth}
            disabled={!isFullyReconciled || isClosingMonth || isRunningAll}
            title={
              !isFullyReconciled
                ? 'All projects must be reconciled with no warnings or critical items to close the month'
                : 'Generate WIP report and close the month'
            }
            className={`flex items-center px-6 py-3 font-medium rounded-lg shadow-sm ${
              isFullyReconciled && !isRunningAll
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

      {/* Progress Bar (when running all) */}
      {isRunningAll && (
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              Running reconciliation for all projects...
            </span>
            <span className="text-sm text-gray-500">
              {currentProjectIndex + 1} of {cocProjects.length}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-procore-blue h-2 rounded-full transition-all duration-300"
              style={{ width: `${((currentProjectIndex + 1) / cocProjects.length) * 100}%` }}
            />
          </div>
          <p className="text-sm text-gray-500 mt-2">
            Currently processing: <span className="font-medium">{cocProjects[currentProjectIndex]?.name || '...'}</span>
          </p>
        </div>
      )}

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
                  <div className={`rounded-lg p-3 ${getProjectStatusBg(project)}`}>
                    {getProjectStatusIcon(project)}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{project.name}</h3>
                    <p className="text-sm text-gray-500">
                      {project.project_number && `#${project.project_number} • `}
                      {getProjectStatusText(project)}
                    </p>
                    {project.reconciliationState?.status === 'error' && (
                      <p className="text-xs text-red-500 mt-1">{project.reconciliationState.error}</p>
                    )}
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
                  ) : project.reconciliationState?.status === 'fetching_procore' || project.reconciliationState?.status === 'reconciling' ? (
                    <div className="flex items-center text-blue-500">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      <span className="text-sm font-medium">
                        {project.reconciliationState?.status === 'fetching_procore' ? 'Fetching data...' : 'Reconciling...'}
                      </span>
                    </div>
                  ) : (
                    <button
                      onClick={() => runReconciliationForProject(project)}
                      disabled={isRunningAll}
                      className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium ${
                        isRunningAll
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-procore-blue text-white hover:bg-blue-700'
                      }`}
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Run Reconciliation
                    </button>
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
