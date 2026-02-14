import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  Building2,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Play,
  Settings,
  XCircle,
  Wrench,
} from 'lucide-react'
import { getProjects, getDashboardStats, supabase, isSupabaseConfigured } from '../lib/supabase'
import StatsCard from '../components/StatsCard'
import ProjectCard from '../components/ProjectCard'

function getUserId(): string {
  let userId = localStorage.getItem('closeout_user_id')
  if (!userId) {
    userId = 'user_' + Math.random().toString(36).substring(2, 15)
    localStorage.setItem('closeout_user_id', userId)
  }
  return userId
}

interface ConnectionStatus {
  procore: boolean
  quickbooks: boolean
}

export default function Dashboard() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    procore: false,
    quickbooks: false,
  })
  const [checkingConnection, setCheckingConnection] = useState(true)

  const { data: projects, isLoading: projectsLoading, refetch: refetchProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
    enabled: isSupabaseConfigured,
  })

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: getDashboardStats,
    enabled: isSupabaseConfigured,
  })

  function handleProjectDeleted() {
    refetchProjects()
    refetchStats()
  }

  // Show setup screen if Supabase is not configured
  if (!isSupabaseConfigured) {
    // Debug info
    const debugUrl = import.meta.env.VITE_SUPABASE_URL
    const debugKey = import.meta.env.VITE_SUPABASE_ANON_KEY

    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="card text-center py-12">
          <Wrench className="w-16 h-16 text-procore-blue mx-auto mb-6" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Setup Required
          </h1>
          <p className="text-gray-600 mb-6">
            Configure your environment variables in Netlify to get started.
          </p>

          <div className="text-left bg-gray-50 rounded-lg p-6 mb-6">
            <h3 className="font-semibold text-gray-900 mb-3">
              Required Environment Variables:
            </h3>
            <ul className="space-y-2 text-sm font-mono">
              <li className="flex items-start">
                <span className="text-gray-400 mr-2">•</span>
                <span><strong>VITE_SUPABASE_URL</strong> - Your Supabase project URL</span>
              </li>
              <li className="flex items-start">
                <span className="text-gray-400 mr-2">•</span>
                <span><strong>VITE_SUPABASE_ANON_KEY</strong> - Your Supabase anon key</span>
              </li>
              <li className="flex items-start">
                <span className="text-gray-400 mr-2">•</span>
                <span><strong>SUPABASE_SERVICE_KEY</strong> - For serverless functions</span>
              </li>
            </ul>
          </div>

          <div className="text-left bg-blue-50 rounded-lg p-4 text-sm text-blue-800 mb-4">
            <strong>Note:</strong> After adding environment variables in Netlify,
            you must trigger a new deploy for them to take effect.
          </div>

          {/* Debug info */}
          <div className="text-left bg-yellow-50 rounded-lg p-4 text-sm text-yellow-800">
            <strong>Debug:</strong>
            <ul className="mt-2 space-y-1">
              <li>VITE_SUPABASE_URL: {debugUrl ? `"${debugUrl.substring(0, 30)}..."` : '(not set)'}</li>
              <li>VITE_SUPABASE_ANON_KEY: {debugKey ? `"${debugKey.substring(0, 20)}..."` : '(not set)'}</li>
            </ul>
          </div>
        </div>
      </div>
    )
  }

  useEffect(() => {
    checkConnections()
  }, [])

  async function checkConnections() {
    const userId = getUserId()
    try {
      const { data } = await supabase
        .from('api_credentials')
        .select('provider')
        .eq('user_id', userId)

      const status: ConnectionStatus = { procore: false, quickbooks: false }
      for (const cred of data || []) {
        if (cred.provider === 'procore') status.procore = true
        if (cred.provider === 'quickbooks') status.quickbooks = true
      }
      setConnectionStatus(status)
    } catch (error) {
      console.error('Error checking connections:', error)
    } finally {
      setCheckingConnection(false)
    }
  }

  const bothConnected = connectionStatus.procore && connectionStatus.quickbooks
  const hasProjects = projects && projects.length > 0

  return (
    <div className="space-y-8">
      {/* Header with Action Button */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Financial Closeout Dashboard
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Reconcile Procore projects with QuickBooks financials
          </p>
        </div>
        {bothConnected ? (
          <Link
            to="/run"
            className="flex items-center px-6 py-3 bg-procore-blue text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm"
          >
            <Play className="w-5 h-5 mr-2" />
            Run Reconciliation
          </Link>
        ) : (
          <Link
            to="/settings"
            className="flex items-center px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
          >
            <Settings className="w-5 h-5 mr-2" />
            Connect Accounts
          </Link>
        )}
      </div>

      {/* Connection Status Banner */}
      {!checkingConnection && (
        <div
          className={`rounded-lg p-4 ${
            bothConnected
              ? 'bg-green-50 border border-green-200'
              : 'bg-yellow-50 border border-yellow-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-6">
              <div className="flex items-center">
                {connectionStatus.procore ? (
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                ) : (
                  <XCircle className="w-5 h-5 text-gray-400 mr-2" />
                )}
                <span
                  className={
                    connectionStatus.procore ? 'text-green-700' : 'text-gray-500'
                  }
                >
                  Procore
                </span>
              </div>
              <div className="flex items-center">
                {connectionStatus.quickbooks ? (
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                ) : (
                  <XCircle className="w-5 h-5 text-gray-400 mr-2" />
                )}
                <span
                  className={
                    connectionStatus.quickbooks ? 'text-green-700' : 'text-gray-500'
                  }
                >
                  QuickBooks
                </span>
              </div>
            </div>
            {!bothConnected && (
              <Link
                to="/settings"
                className="text-sm font-medium text-yellow-700 hover:text-yellow-800"
              >
                Connect accounts to get started →
              </Link>
            )}
          </div>
        </div>
      )}

      {projectsLoading || statsLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-procore-blue"></div>
        </div>
      ) : (
        <>
          {/* Stats Cards - Only show real data */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatsCard
              title="Reconciled Projects"
              value={String(stats?.projectCount || 0)}
              icon={Building2}
              color="blue"
            />
            <StatsCard
              title="Open Closeout Items"
              value={String(stats?.openItemsCount || 0)}
              icon={CheckCircle}
              color="yellow"
            />
            <StatsCard
              title="Warnings"
              value={String(stats?.totalWarnings || 0)}
              icon={AlertTriangle}
              color="yellow"
            />
            <StatsCard
              title="Critical Issues"
              value={String(stats?.totalCritical || 0)}
              icon={AlertCircle}
              color="red"
            />
          </div>

          {/* Projects List */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Reconciliation Reports
            </h2>
            {hasProjects ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {projects.map((project) => (
                  <ProjectCard key={project.id} project={project} onDeleted={handleProjectDeleted} />
                ))}
              </div>
            ) : (
              <div className="card text-center py-12">
                <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900">No Reconciliation Reports Yet</h3>
                <p className="text-gray-500 mt-1 mb-4">
                  {bothConnected
                    ? 'Run your first reconciliation to see results here'
                    : 'Connect your Procore and QuickBooks accounts to get started'}
                </p>
                {bothConnected ? (
                  <Link
                    to="/run"
                    className="inline-flex items-center px-4 py-2 bg-procore-blue text-white rounded-lg hover:bg-blue-700"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Run Reconciliation
                  </Link>
                ) : (
                  <Link
                    to="/settings"
                    className="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    Connect Accounts
                  </Link>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
