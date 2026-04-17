import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle, ExternalLink, RefreshCw, Loader2, Bug } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

interface ConnectionStatus {
  connected: boolean
  companyId?: string
  connectedAt?: string
}

interface DiagResult {
  label: string
  status: number
  count: number | null
  error: string | null
  sampleKeys: string[] | null
}

export default function Settings() {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<ConnectionStatus>({ connected: false })
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [diagnosing, setDiagnosing] = useState(false)
  const [diagResults, setDiagResults] = useState<DiagResult[] | null>(null)
  const [diagProject, setDiagProject] = useState<string | null>(null)

  const { user } = useAuth()
  const userId = user?.id || 'anonymous'

  useEffect(() => {
    checkConnection()

    const connected = searchParams.get('connected')
    const oauthError = searchParams.get('error')
    if (connected === 'procore') {
      setMessage('Successfully connected to Procore! Syncing data...')
      setMessageType('success')
      setTimeout(() => runSync(), 1000)
    } else if (oauthError) {
      setMessage(`Connection failed: ${decodeURIComponent(oauthError).replace(/_/g, ' ')}`)
      setMessageType('error')
    }
  }, [searchParams])

  async function checkConnection() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('api_credentials')
        .select('*')
        .eq('user_id', userId)
        .eq('provider', 'procore')
        .maybeSingle()

      if (error) throw error

      if (data) {
        setStatus({
          connected: true,
          companyId: data.credentials?.company_id,
          connectedAt: data.connected_at,
        })
      } else {
        setStatus({ connected: false })
      }
    } catch (error) {
      console.error('Error checking connection:', error)
    } finally {
      setLoading(false)
    }
  }

  async function runSync() {
    setSyncing(true)
    setMessage('Syncing data from Procore...')
    setMessageType('success')
    try {
      const res = await fetch('/.netlify/functions/procore-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const result = await res.json()

      if (!res.ok) throw new Error(result.error || 'Sync failed')

      const s = result.synced || {}
      const details = []
      if (s.projects) details.push(`${s.projects} projects`)
      if (s.contracts) details.push(`${s.contracts} contracts`)
      if (s.subcontracts) details.push(`${s.subcontracts} subs`)
      if (s.change_orders) details.push(`${s.change_orders} COs`)
      if (s.pay_apps) details.push(`${s.pay_apps} pay apps`)
      if (s.rfis) details.push(`${s.rfis} RFIs`)
      if (s.submittals) details.push(`${s.submittals} submittals`)
      if (s.punch_items) details.push(`${s.punch_items} punch items`)
      if (s.budget_lines) details.push(`${s.budget_lines} budget lines`)
      const projNote = result.projects_detailed ? ` (${result.projects_detailed}/${result.total_active} projects detailed)` : ''
      setMessage(`Sync complete! ${details.join(', ')}${projNote}`)
      setMessageType('success')
      setTimeout(() => setMessage(null), 12000)
    } catch (err: any) {
      setMessage(`Sync error: ${err.message}`)
      setMessageType('error')
      setTimeout(() => setMessage(null), 8000)
    } finally {
      setSyncing(false)
    }
  }

  async function disconnect() {
    try {
      const { error: deleteError } = await supabase
        .from('api_credentials')
        .delete()
        .eq('user_id', userId)
        .eq('provider', 'procore')

      if (deleteError) {
        console.error('Delete failed:', deleteError)
        setMessage(`Failed to disconnect: ${deleteError.message}`)
        setMessageType('error')
        setTimeout(() => setMessage(null), 5000)
        return
      }

      await checkConnection()
      setMessage('Disconnected from Procore')
      setMessageType('success')
      setTimeout(() => setMessage(null), 3000)
    } catch (error: any) {
      console.error('Error disconnecting:', error)
      setMessage(`Disconnect error: ${error.message}`)
      setMessageType('error')
      setTimeout(() => setMessage(null), 5000)
    }
  }

  async function runDiagnostics() {
    setDiagnosing(true)
    setDiagResults(null)
    setDiagProject(null)
    try {
      const res = await fetch('/.netlify/functions/procore-diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Diagnostics failed')
      setDiagResults(result.results || [])
      setDiagProject(result.testProject ? `${result.testProject.name} (${result.testProject.id})` : null)
    } catch (err: any) {
      setMessage(`Diagnostics error: ${err.message}`)
      setMessageType('error')
    } finally {
      setDiagnosing(false)
    }
  }

  function connectProcore() {
    const clientId = import.meta.env.VITE_PROCORE_CLIENT_ID || ''
    if (!clientId) {
      setMessage('Procore Client ID not configured. Set VITE_PROCORE_CLIENT_ID in Netlify environment variables.')
      setMessageType('error')
      return
    }
    const redirectUri = `${window.location.origin}/.netlify/functions/oauth-callback?provider=procore`
    const nonce = crypto.randomUUID()
    const state = btoa(JSON.stringify({ userId, nonce, provider: 'procore' }))

    const authUrl = new URL('https://login.procore.com/oauth/authorize')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('state', state)

    window.location.href = authUrl.toString()
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-clipper-black">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connect your Procore account to pull live project data
        </p>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-lg border ${
          messageType === 'error'
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          {syncing && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}
          {message}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="card">
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-4">
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                <span className="text-orange-600 font-bold text-lg">P</span>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Procore</h3>
                <p className="text-sm text-gray-500">Source of truth for all project data</p>
                {status.connected && (
                  <div className="mt-2 text-sm">
                    <p className="text-green-600 flex items-center">
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Connected
                    </p>
                    {status.companyId && (
                      <p className="text-gray-500">Company ID: {status.companyId}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {status.connected ? (
                <>
                  <button
                    onClick={runSync}
                    disabled={syncing}
                    className="px-4 py-2 text-sm font-medium text-clipper-black bg-clipper-gold rounded-lg hover:bg-clipper-gold-dark disabled:opacity-50 flex items-center"
                  >
                    {syncing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                    Sync Now
                  </button>
                  <button
                    onClick={disconnect}
                    className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100"
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  onClick={connectProcore}
                  className="px-4 py-2 text-sm font-medium text-white bg-orange-500 rounded-lg hover:bg-orange-600 flex items-center"
                >
                  Connect
                  <ExternalLink className="w-4 h-4 ml-1" />
                </button>
              )}
            </div>
          </div>

          {status.connected && (
            <div className="mt-4 pt-4 border-t border-gray-100 text-sm text-gray-500 flex items-center justify-between">
              <span>Use "Sync Now" to pull the latest projects, contracts, change orders, RFIs, submittals, pay apps, and punch items from Procore.</span>
              <button
                onClick={runDiagnostics}
                disabled={diagnosing}
                className="ml-4 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50 flex items-center shrink-0"
              >
                {diagnosing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Bug className="w-3 h-3 mr-1" />}
                Diagnose API
              </button>
            </div>
          )}
        </div>
      )}

      {diagResults && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">API Diagnostics</h3>
          {diagProject && <p className="text-xs text-gray-500 mb-3">Testing against: {diagProject}</p>}
          <div className="space-y-1">
            {diagResults.map((r, i) => (
              <div key={i} className={`flex items-center justify-between text-xs px-2 py-1.5 rounded ${
                r.status === 200 && r.count && r.count > 0
                  ? 'bg-green-50 text-green-800'
                  : r.status === 200 && r.count === 0
                  ? 'bg-yellow-50 text-yellow-800'
                  : r.status === 403
                  ? 'bg-orange-50 text-orange-800'
                  : r.status === 404
                  ? 'bg-gray-50 text-gray-600'
                  : 'bg-red-50 text-red-800'
              }`}>
                <span className="font-medium">{r.label}</span>
                <span className="flex items-center gap-2">
                  <span className="font-mono">{r.status}</span>
                  {r.count !== null && <span>{r.count} items</span>}
                  {r.error && <span className="max-w-xs truncate" title={r.error}>{r.error.substring(0, 80)}</span>}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Green = data returned, Yellow = 200 but empty, Orange = 403 forbidden, Gray = 404 not found, Red = error
          </p>
        </div>
      )}
    </div>
  )
}
