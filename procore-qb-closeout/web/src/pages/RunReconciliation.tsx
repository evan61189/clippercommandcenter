import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Play,
  CheckCircle,
  AlertCircle,
  Loader2,
  Building2,
  RefreshCw,
} from 'lucide-react'

function getUserId(): string {
  return localStorage.getItem('closeout_user_id') || ''
}

interface ProcoreProject {
  id: number
  name: string
  project_number: string
  status: string
}

type Step = 'select' | 'fetching' | 'reconciling' | 'complete' | 'error'

export default function RunReconciliation() {
  const [step, setStep] = useState<Step>('select')
  const [projects, setProjects] = useState<ProcoreProject[]>([])
  const [selectedProject, setSelectedProject] = useState<ProcoreProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>('')
  const [result, setResult] = useState<any>(null)

  const userId = getUserId()

  useEffect(() => {
    loadProjects()
  }, [])

  async function loadProjects() {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/.netlify/functions/procore-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getProjects', userId }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load projects')
      }

      setProjects(data || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function runReconciliation() {
    if (!selectedProject) return

    setStep('fetching')
    setProgress('Fetching data from Procore...')
    setError(null)

    try {
      // Fetch Procore data
      const procoreResponse = await fetch('/.netlify/functions/procore-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getFullProjectData',
          projectId: selectedProject.id,
          userId,
        }),
      })

      const procoreData = await procoreResponse.json()
      if (!procoreResponse.ok) {
        throw new Error(procoreData.error || 'Failed to fetch Procore data')
      }

      setProgress('Fetching data from QuickBooks...')

      // Fetch QuickBooks data
      const qbResponse = await fetch('/.netlify/functions/quickbooks-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getFullData', userId }),
      })

      const qbData = await qbResponse.json()
      if (!qbResponse.ok) {
        throw new Error(qbData.error || 'Failed to fetch QuickBooks data')
      }

      setStep('reconciling')
      setProgress('Running reconciliation analysis...')

      // Generate a project ID for Supabase
      const projectId = crypto.randomUUID()

      // Run reconciliation
      const reconResponse = await fetch('/.netlify/functions/run-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          procoreData,
          qbData,
          projectId,
          userId,
        }),
      })

      const reconResult = await reconResponse.json()
      if (!reconResponse.ok) {
        throw new Error(reconResult.error || 'Reconciliation failed')
      }

      setResult(reconResult)
      setStep('complete')
    } catch (err: any) {
      setError(err.message)
      setStep('error')
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="w-12 h-12 animate-spin text-procore-blue mb-4" />
        <p className="text-gray-500">Loading projects from Procore...</p>
      </div>
    )
  }

  if (error && step === 'select') {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Link to="/" className="flex items-center text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Dashboard
        </Link>

        <div className="card bg-red-50 border-red-200">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-red-800">Connection Error</h3>
              <p className="text-sm text-red-700 mt-1">{error}</p>
              <Link
                to="/settings"
                className="mt-3 inline-block text-sm font-medium text-red-700 underline"
              >
                Go to Settings to connect your accounts
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link to="/" className="flex items-center text-gray-600 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Dashboard
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Run Reconciliation</h1>
        <p className="mt-1 text-sm text-gray-500">
          Select a Procore project to reconcile with QuickBooks
        </p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center justify-between px-4">
        {['Select Project', 'Fetch Data', 'Reconcile', 'Complete'].map((label, idx) => {
          const stepMap: Record<number, Step[]> = {
            0: ['select'],
            1: ['fetching'],
            2: ['reconciling'],
            3: ['complete'],
          }
          const isActive = stepMap[idx]?.includes(step)
          const isPast =
            (idx === 0 && step !== 'select') ||
            (idx === 1 && !['select', 'fetching'].includes(step)) ||
            (idx === 2 && ['complete'].includes(step))

          return (
            <div key={label} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  isPast
                    ? 'bg-green-500 text-white'
                    : isActive
                    ? 'bg-procore-blue text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {isPast ? <CheckCircle className="w-5 h-5" /> : idx + 1}
              </div>
              <span
                className={`ml-2 text-sm ${
                  isActive ? 'text-gray-900 font-medium' : 'text-gray-500'
                }`}
              >
                {label}
              </span>
              {idx < 3 && <div className="w-12 h-0.5 bg-gray-200 mx-4" />}
            </div>
          )
        })}
      </div>

      {/* Step Content */}
      {step === 'select' && (
        <div className="space-y-4">
          <div className="card">
            <h3 className="font-medium text-gray-900 mb-4">Select Procore Project</h3>
            {projects.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                No projects found in your Procore account.
              </p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => setSelectedProject(project)}
                    className={`w-full text-left p-4 rounded-lg border transition-colors ${
                      selectedProject?.id === project.id
                        ? 'border-procore-blue bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center">
                      <Building2 className="w-5 h-5 text-gray-400 mr-3" />
                      <div>
                        <p className="font-medium text-gray-900">{project.name}</p>
                        <p className="text-sm text-gray-500">
                          {project.project_number && `#${project.project_number} · `}
                          {project.status}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={runReconciliation}
              disabled={!selectedProject}
              className={`flex items-center px-6 py-3 rounded-lg font-medium ${
                selectedProject
                  ? 'bg-procore-blue text-white hover:bg-blue-700'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Play className="w-5 h-5 mr-2" />
              Run Reconciliation
            </button>
          </div>
        </div>
      )}

      {(step === 'fetching' || step === 'reconciling') && (
        <div className="card">
          <div className="flex flex-col items-center py-12">
            <Loader2 className="w-16 h-16 animate-spin text-procore-blue mb-4" />
            <h3 className="text-lg font-medium text-gray-900">{progress}</h3>
            <p className="text-sm text-gray-500 mt-2">
              This may take a minute depending on the project size
            </p>
          </div>
        </div>
      )}

      {step === 'error' && (
        <div className="card bg-red-50 border-red-200">
          <div className="flex flex-col items-center py-8">
            <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
            <h3 className="text-lg font-medium text-red-800">Reconciliation Failed</h3>
            <p className="text-sm text-red-700 mt-2">{error}</p>
            <button
              onClick={() => setStep('select')}
              className="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {step === 'complete' && result && (
        <div className="space-y-6">
          <div className="card bg-green-50 border-green-200">
            <div className="flex items-start space-x-4">
              <CheckCircle className="w-8 h-8 text-green-500 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-medium text-green-800">
                  Reconciliation Complete!
                </h3>
                <p className="text-sm text-green-700 mt-1">
                  Successfully analyzed {result.commitments?.length || 0} commitments
                </p>
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card text-center">
              <p className="text-sm text-gray-500">Total Committed</p>
              <p className="text-xl font-semibold text-gray-900">
                ${(result.total_committed || 0).toLocaleString()}
              </p>
            </div>
            <div className="card text-center">
              <p className="text-sm text-gray-500">Reconciled</p>
              <p className="text-xl font-semibold text-green-600">
                {result.reconciled_items || 0}
              </p>
            </div>
            <div className="card text-center">
              <p className="text-sm text-gray-500">Warnings</p>
              <p className="text-xl font-semibold text-yellow-600">
                {result.warning_items || 0}
              </p>
            </div>
            <div className="card text-center">
              <p className="text-sm text-gray-500">Critical</p>
              <p className="text-xl font-semibold text-red-600">
                {result.critical_items || 0}
              </p>
            </div>
          </div>

          {/* AI Summary */}
          {result.executive_summary && (
            <div className="card">
              <h3 className="font-medium text-gray-900 mb-2">AI Analysis Summary</h3>
              <p className="text-sm text-gray-700">{result.executive_summary}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-between">
            <button
              onClick={() => {
                setStep('select')
                setSelectedProject(null)
                setResult(null)
              }}
              className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-900"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Run Another
            </button>
            <Link
              to={result.id ? `/report/${result.id}` : '/'}
              className="flex items-center px-6 py-3 bg-procore-blue text-white rounded-lg hover:bg-blue-700"
            >
              View Full Report
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
