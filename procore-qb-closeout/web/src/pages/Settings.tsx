import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle, XCircle, ExternalLink, RefreshCw, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

interface ConnectionStatus {
  procore: { connected: boolean; companyId?: string; connectedAt?: string }
  quickbooks: { connected: boolean; realmId?: string; companyName?: string; connectedAt?: string }
}

export default function Settings() {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<ConnectionStatus>({
    procore: { connected: false },
    quickbooks: { connected: false },
  })
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncingQB, setSyncingQB] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const { user } = useAuth()
  const userId = user?.id || 'anonymous'

  useEffect(() => {
    checkConnections()

    // Show success message and auto-sync if just connected
    const connected = searchParams.get('connected')
    if (connected === 'procore') {
      setMessage('Successfully connected to Procore! Syncing data...')
      setMessageType('success')
      setTimeout(() => runSync(), 1000)
    } else if (connected === 'quickbooks') {
      setMessage('Successfully connected to QuickBooks! Syncing data...')
      setMessageType('success')
      setTimeout(() => runQBSync(), 1000)
    }
  }, [searchParams])

  async function checkConnections() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('api_credentials')
        .select('*')
        .eq('user_id', userId)

      if (error) throw error

      const newStatus: ConnectionStatus = {
        procore: { connected: false },
        quickbooks: { connected: false },
      }

      for (const cred of data || []) {
        if (cred.provider === 'procore') {
          newStatus.procore = {
            connected: true,
            companyId: cred.credentials?.company_id,
            connectedAt: cred.connected_at,
          }
        } else if (cred.provider === 'quickbooks') {
          newStatus.quickbooks = {
            connected: true,
            realmId: cred.credentials?.realm_id,
            connectedAt: cred.connected_at,
          }
        }
      }

      setStatus(newStatus)
    } catch (error) {
      console.error('Error checking connections:', error)
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

      setMessage(`Sync complete! ${result.synced?.projects || 0} projects and ${result.synced?.contracts || 0} contracts synced from Procore.`)
      setMessageType('success')
      setTimeout(() => setMessage(null), 8000)
    } catch (err: any) {
      setMessage(`Sync error: ${err.message}`)
      setMessageType('error')
      setTimeout(() => setMessage(null), 8000)
    } finally {
      setSyncing(false)
    }
  }

  async function runQBSync() {
    setSyncingQB(true)
    setMessage('Syncing data from QuickBooks...')
    setMessageType('success')
    try {
      const res = await fetch('/.netlify/functions/quickbooks-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const result = await res.json()

      if (!res.ok) throw new Error(result.error || 'QB Sync failed')

      const s = result.synced || {}
      const parts = [`${s.ar_invoices || 0} invoices`, `${s.ap_bills || 0} bills`, `${s.bank_accounts || 0} bank accounts`]
      if (s.job_costs > 0) parts.push(`${s.job_costs} job costs`)
      if (s.new_mappings > 0) parts.push(`${s.new_mappings} new project mappings`)
      setMessage(`QuickBooks sync complete! ${parts.join(', ')} synced.`)
      setMessageType('success')
      setTimeout(() => setMessage(null), 8000)
    } catch (err: any) {
      setMessage(`QuickBooks sync error: ${err.message}`)
      setMessageType('error')
      setTimeout(() => setMessage(null), 8000)
    } finally {
      setSyncingQB(false)
    }
  }

  async function disconnect(provider: 'procore' | 'quickbooks') {
    try {
      // If QuickBooks, revoke token with Intuit first
      if (provider === 'quickbooks') {
        try {
          await fetch('/.netlify/functions/quickbooks-revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId }),
          })
        } catch (e) {
          console.warn('Token revocation failed, proceeding with local disconnect')
        }
      }

      await supabase
        .from('api_credentials')
        .delete()
        .eq('user_id', userId)
        .eq('provider', provider)

      checkConnections()
      setMessage(`Disconnected from ${provider === 'procore' ? 'Procore' : 'QuickBooks'}`)
      setMessageType('success')
      setTimeout(() => setMessage(null), 3000)
    } catch (error) {
      console.error('Error disconnecting:', error)
    }
  }

  function generateCsrfState(provider: string): string {
    const nonce = crypto.randomUUID()
    const state = JSON.stringify({ userId, nonce, provider })
    sessionStorage.setItem('oauth_csrf_state', state)
    return btoa(state)
  }

  function connectProcore() {
    const clientId = import.meta.env.VITE_PROCORE_CLIENT_ID || '5m6ntNDYctNihGwfspa4OiG6EXHXx1HCXSHRVetAb7k'
    const redirectUri = `${window.location.origin}/.netlify/functions/oauth-callback?provider=procore`

    const authUrl = new URL('https://login.procore.com/oauth/authorize')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('state', generateCsrfState('procore'))

    window.location.href = authUrl.toString()
  }

  function connectQuickBooks() {
    const clientId = import.meta.env.VITE_QBO_CLIENT_ID || 'ABenQKVtNNzyfGlYzpNUsu5CF3O8t9PzrQw2LnxcgpnHEVAe2F'
    const redirectUri = `${window.location.origin}/.netlify/functions/oauth-callback?provider=quickbooks`
    const scope = 'com.intuit.quickbooks.accounting'

    const authUrl = new URL('https://appcenter.intuit.com/connect/oauth2')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('scope', scope)
    authUrl.searchParams.set('state', generateCsrfState('quickbooks'))

    window.location.href = authUrl.toString()
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-clipper-black">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connect your Procore and QuickBooks accounts to pull live data
        </p>
      </div>

      {/* Message */}
      {message && (
        <div className={`px-4 py-3 rounded-lg border ${
          messageType === 'error'
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          {(syncing || syncingQB) && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}
          {message}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Procore Connection */}
          <div className="card">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-4">
                <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                  <span className="text-orange-600 font-bold text-lg">P</span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Procore</h3>
                  <p className="text-sm text-gray-500">Construction project management</p>
                  {status.procore.connected && (
                    <div className="mt-2 text-sm">
                      <p className="text-green-600 flex items-center">
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Connected
                      </p>
                      {status.procore.companyId && (
                        <p className="text-gray-500">Company ID: {status.procore.companyId}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {status.procore.connected ? (
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
                      onClick={() => disconnect('procore')}
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
          </div>

          {/* QuickBooks Connection */}
          <div className="card">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-4">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <span className="text-green-600 font-bold text-lg">QB</span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">QuickBooks Online</h3>
                  <p className="text-sm text-gray-500">Accounting and financial management</p>
                  {status.quickbooks.connected && (
                    <div className="mt-2 text-sm">
                      <p className="text-green-600 flex items-center">
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Connected
                      </p>
                      {status.quickbooks.realmId && (
                        <p className="text-gray-500">Company ID: {status.quickbooks.realmId}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {status.quickbooks.connected ? (
                  <>
                    <button
                      onClick={runQBSync}
                      disabled={syncingQB}
                      className="px-4 py-2 text-sm font-medium text-clipper-black bg-clipper-gold rounded-lg hover:bg-clipper-gold-dark disabled:opacity-50 flex items-center"
                    >
                      {syncingQB ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                      Sync Now
                    </button>
                    <button
                      onClick={() => disconnect('quickbooks')}
                      className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100"
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    onClick={connectQuickBooks}
                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 flex items-center"
                  >
                    Connect
                    <ExternalLink className="w-4 h-4 ml-1" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Status Summary */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-2">Connection Status</h4>
            <div className="flex items-center space-x-6">
              <div className="flex items-center">
                {status.procore.connected ? (
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                ) : (
                  <XCircle className="w-5 h-5 text-gray-400 mr-2" />
                )}
                <span className={status.procore.connected ? 'text-green-700' : 'text-gray-500'}>
                  Procore
                </span>
              </div>
              <div className="flex items-center">
                {status.quickbooks.connected ? (
                  <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                ) : (
                  <XCircle className="w-5 h-5 text-gray-400 mr-2" />
                )}
                <span className={status.quickbooks.connected ? 'text-green-700' : 'text-gray-500'}>
                  QuickBooks
                </span>
              </div>
            </div>
            {status.procore.connected ? (
              <p className="mt-3 text-sm text-green-600">
                Data will sync from connected services. Use "Sync Now" to pull the latest data.
              </p>
            ) : (
              <p className="mt-3 text-sm text-gray-500">
                Connect your accounts to pull project and financial data into the dashboard.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
