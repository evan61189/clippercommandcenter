import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle, XCircle, ExternalLink, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'

// Generate a simple user ID for demo purposes
// In production, use proper authentication
function getUserId(): string {
  let userId = localStorage.getItem('closeout_user_id')
  if (!userId) {
    userId = 'user_' + Math.random().toString(36).substring(2, 15)
    localStorage.setItem('closeout_user_id', userId)
  }
  return userId
}

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
  const [message, setMessage] = useState<string | null>(null)

  const userId = getUserId()

  useEffect(() => {
    checkConnections()

    // Show success message if just connected
    const connected = searchParams.get('connected')
    if (connected) {
      setMessage(`Successfully connected to ${connected === 'procore' ? 'Procore' : 'QuickBooks'}!`)
      setTimeout(() => setMessage(null), 5000)
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

  async function disconnect(provider: 'procore' | 'quickbooks') {
    try {
      await supabase
        .from('api_credentials')
        .delete()
        .eq('user_id', userId)
        .eq('provider', provider)

      checkConnections()
      setMessage(`Disconnected from ${provider === 'procore' ? 'Procore' : 'QuickBooks'}`)
      setTimeout(() => setMessage(null), 3000)
    } catch (error) {
      console.error('Error disconnecting:', error)
    }
  }

  function connectProcore() {
    // Hardcoded Procore client ID as fallback
    const clientId = import.meta.env.VITE_PROCORE_CLIENT_ID || '5m6ntNDYctNihGwfspa4OiG6EXHXx1HCXSHRVetAb7k'
    const redirectUri = `${window.location.origin}/.netlify/functions/oauth-callback?provider=procore`

    const authUrl = new URL('https://login.procore.com/oauth/authorize')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('state', userId)

    window.location.href = authUrl.toString()
  }

  function connectQuickBooks() {
    // Hardcoded QuickBooks client ID as fallback
    const clientId = import.meta.env.VITE_QBO_CLIENT_ID || 'ABgPHajheBYc4ajSSov1P8b8emmalTPmmw5uAn99gUcfg2bOo9'
    const redirectUri = `${window.location.origin}/.netlify/functions/oauth-callback?provider=quickbooks`
    const scope = 'com.intuit.quickbooks.accounting'

    const authUrl = new URL('https://appcenter.intuit.com/connect/oauth2')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('scope', scope)
    authUrl.searchParams.set('state', userId)

    window.location.href = authUrl.toString()
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back link */}
      <Link
        to="/"
        className="flex items-center text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Dashboard
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connect your Procore and QuickBooks accounts to run reconciliation
        </p>
      </div>

      {/* Success/Error Message */}
      {message && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
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
                  <p className="text-sm text-gray-500">
                    Construction project management
                  </p>
                  {status.procore.connected && (
                    <div className="mt-2 text-sm">
                      <p className="text-green-600 flex items-center">
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Connected
                      </p>
                      {status.procore.companyId && (
                        <p className="text-gray-500">
                          Company ID: {status.procore.companyId}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div>
                {status.procore.connected ? (
                  <button
                    onClick={() => disconnect('procore')}
                    className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100"
                  >
                    Disconnect
                  </button>
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
                  <h3 className="text-lg font-semibold text-gray-900">
                    QuickBooks Online
                  </h3>
                  <p className="text-sm text-gray-500">
                    Accounting and financial management
                  </p>
                  {status.quickbooks.connected && (
                    <div className="mt-2 text-sm">
                      <p className="text-green-600 flex items-center">
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Connected
                      </p>
                      {status.quickbooks.realmId && (
                        <p className="text-gray-500">
                          Company ID: {status.quickbooks.realmId}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div>
                {status.quickbooks.connected ? (
                  <button
                    onClick={() => disconnect('quickbooks')}
                    className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100"
                  >
                    Disconnect
                  </button>
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
            {status.procore.connected && status.quickbooks.connected ? (
              <p className="mt-3 text-sm text-green-600">
                ✓ Both accounts connected. You can now run reconciliation from the Dashboard.
              </p>
            ) : (
              <p className="mt-3 text-sm text-gray-500">
                Connect both accounts to run financial closeout reconciliation.
              </p>
            )}
          </div>

          {/* Help Section */}
          <div className="card bg-blue-50 border-blue-200">
            <h4 className="font-medium text-blue-900 mb-2">Need Help?</h4>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>
                • <strong>Procore:</strong> You'll be redirected to Procore to authorize access
              </li>
              <li>
                • <strong>QuickBooks:</strong> Sign in with your Intuit account and select your company
              </li>
              <li>
                • Your credentials are securely stored and used only for reconciliation
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
