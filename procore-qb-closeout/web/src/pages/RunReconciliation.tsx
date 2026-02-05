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
  let userId = localStorage.getItem('closeout_user_id')
  if (!userId) {
    userId = 'user_' + Math.random().toString(36).substring(2, 15)
    localStorage.setItem('closeout_user_id', userId)
  }
  return userId
}

interface ProcoreProject {
  id: number
  name: string
  project_number: string
  status: string
}

type Step = 'select' | 'fetching_procore' | 'procore_fetched' | 'fetching_qb' | 'reconciling' | 'complete' | 'error'

type DataView = 'vendors' | 'subcontracts' | 'purchaseOrders' | 'primeContract' | 'subInvoices' | 'paymentApplications' | 'changeOrders' | 'directCosts' | 'costCodes' | null

// Simple data card button
function DataCard({
  title,
  count,
  bgColor,
  textColor,
  isSelected,
  onSelect,
}: {
  title: string
  count: number
  bgColor: string
  textColor: string
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-center p-3 ${bgColor} rounded-lg hover:opacity-80 transition-opacity cursor-pointer ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
    >
      <p className={`text-2xl font-semibold ${textColor}`}>{count}</p>
      <p className={`text-sm ${textColor} opacity-80`}>{title}</p>
    </button>
  )
}

// Large table component for displaying selected data
function DataTable({
  title,
  data,
  columns,
}: {
  title: string
  data: any[]
  columns: { key: string; label: string; format?: (val: any, item?: any) => string }[]
}) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-white border rounded-lg p-8 text-center text-gray-500">
        No {title.toLowerCase()} found for this project.
      </div>
    )
  }

  return (
    <div className="bg-white border rounded-lg overflow-hidden">
      <div className="bg-gray-100 px-4 py-2 border-b">
        <h4 className="font-medium text-gray-900">{title} ({data.length})</h4>
      </div>
      <div className="overflow-x-auto" style={{ maxHeight: '400px' }}>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className="px-4 py-3 text-left font-medium text-gray-600 border-b">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.map((item: any, idx: number) => (
              <tr key={idx} className="hover:bg-gray-50">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-2 text-gray-700">
                    {col.format ? col.format(item[col.key], item) : (item[col.key] ?? '-')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function RunReconciliation() {
  const [step, setStep] = useState<Step>('select')
  const [projects, setProjects] = useState<ProcoreProject[]>([])
  const [selectedProject, setSelectedProject] = useState<ProcoreProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>('')
  const [result, setResult] = useState<any>(null)
  const [procoreData, setProcoreData] = useState<any>(null)
  const [expandedView, setExpandedView] = useState<DataView>(null)

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

  async function fetchProcoreData() {
    if (!selectedProject) return

    setStep('fetching_procore')
    setProgress('Fetching data from Procore...')
    setError(null)

    try {
      const procoreResponse = await fetch('/.netlify/functions/procore-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getFullProjectData',
          projectId: selectedProject.id,
          userId,
        }),
      })

      const data = await procoreResponse.json()
      if (!procoreResponse.ok) {
        throw new Error(data.error || 'Failed to fetch Procore data')
      }

      setProcoreData(data)
      setStep('procore_fetched')
    } catch (err: any) {
      setError(err.message)
      setStep('error')
    }
  }

  async function fetchQuickBooksData() {
    setStep('fetching_qb')
    setProgress('Fetching data from QuickBooks...')
    setError(null)

    try {
      const qbResponse = await fetch('/.netlify/functions/quickbooks-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getFullData', userId }),
      })

      const data = await qbResponse.json()
      if (!qbResponse.ok) {
        throw new Error(data.error || 'Failed to fetch QuickBooks data')
      }

      await runReconciliation(data)
    } catch (err: any) {
      setError(err.message)
      setStep('error')
    }
  }

  async function runReconciliation(quickbooksData: any) {
    setStep('reconciling')
    setProgress('Running reconciliation analysis...')

    try {
      const projectId = crypto.randomUUID()

      const reconResponse = await fetch('/.netlify/functions/run-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          procoreData,
          qbData: quickbooksData,
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
        {['Select Project', 'Procore Data', 'QuickBooks', 'Reconcile'].map((label, idx) => {
          const stepMap: Record<number, Step[]> = {
            0: ['select'],
            1: ['fetching_procore', 'procore_fetched'],
            2: ['fetching_qb'],
            3: ['reconciling', 'complete'],
          }
          const isActive = stepMap[idx]?.includes(step)
          const isPast =
            (idx === 0 && step !== 'select') ||
            (idx === 1 && !['select', 'fetching_procore', 'procore_fetched'].includes(step)) ||
            (idx === 2 && ['reconciling', 'complete'].includes(step)) ||
            (idx === 3 && step === 'complete')

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
              onClick={fetchProcoreData}
              disabled={!selectedProject}
              className={`flex items-center px-6 py-3 rounded-lg font-medium ${
                selectedProject
                  ? 'bg-procore-blue text-white hover:bg-blue-700'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Play className="w-5 h-5 mr-2" />
              Fetch Procore Data
            </button>
          </div>
        </div>
      )}

      {(step === 'fetching_procore' || step === 'fetching_qb' || step === 'reconciling') && (
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

      {step === 'procore_fetched' && procoreData && (
        <div className="space-y-4">
          <div className="card bg-green-50 border-green-200">
            <div className="flex items-start space-x-3">
              <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0" />
              <div>
                <h3 className="font-medium text-green-800">Procore Data Fetched Successfully!</h3>
                <p className="text-sm text-green-700 mt-1">
                  Review the data below, then continue to fetch QuickBooks data.
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="font-medium text-gray-900 mb-4">Procore Data Summary</h3>
            <p className="text-sm text-gray-500 mb-4">Click any card to view details</p>

            {/* Contracts & Vendors */}
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Contracts & Vendors</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <DataCard
                title="Vendors"
                count={procoreData.vendors?.length || 0}
                bgColor="bg-gray-50"
                textColor="text-gray-900"
                isSelected={expandedView === 'vendors'}
                onSelect={() => setExpandedView(expandedView === 'vendors' ? null : 'vendors')}
              />
              <DataCard
                title="Subcontracts"
                count={procoreData.commitments?.subcontracts?.length || 0}
                bgColor="bg-gray-50"
                textColor="text-gray-900"
                isSelected={expandedView === 'subcontracts'}
                onSelect={() => setExpandedView(expandedView === 'subcontracts' ? null : 'subcontracts')}
              />
              <DataCard
                title="Purchase Orders"
                count={procoreData.commitments?.purchaseOrders?.length || 0}
                bgColor="bg-gray-50"
                textColor="text-gray-900"
                isSelected={expandedView === 'purchaseOrders'}
                onSelect={() => setExpandedView(expandedView === 'purchaseOrders' ? null : 'purchaseOrders')}
              />
              <DataCard
                title="Prime Contracts"
                count={procoreData.primeContract?.length || 0}
                bgColor="bg-gray-50"
                textColor="text-gray-900"
                isSelected={expandedView === 'primeContract'}
                onSelect={() => setExpandedView(expandedView === 'primeContract' ? null : 'primeContract')}
              />
            </div>

            {/* Invoices & Payments */}
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2 mt-4">Invoices & Billings</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
              <DataCard
                title="Sub Invoices"
                count={procoreData.subInvoices?.length || 0}
                bgColor="bg-blue-50"
                textColor="text-blue-900"
                isSelected={expandedView === 'subInvoices'}
                onSelect={() => setExpandedView(expandedView === 'subInvoices' ? null : 'subInvoices')}
              />
              <DataCard
                title="Payment Apps"
                count={procoreData.paymentApplications?.length || 0}
                bgColor="bg-green-50"
                textColor="text-green-900"
                isSelected={expandedView === 'paymentApplications'}
                onSelect={() => setExpandedView(expandedView === 'paymentApplications' ? null : 'paymentApplications')}
              />
              <DataCard
                title="Change Orders"
                count={(procoreData.changeOrders?.commitment?.length || 0) + (procoreData.changeOrders?.prime?.length || 0)}
                bgColor="bg-orange-50"
                textColor="text-orange-900"
                isSelected={expandedView === 'changeOrders'}
                onSelect={() => setExpandedView(expandedView === 'changeOrders' ? null : 'changeOrders')}
              />
              <DataCard
                title="Direct Costs"
                count={procoreData.directCosts?.length || 0}
                bgColor="bg-purple-50"
                textColor="text-purple-900"
                isSelected={expandedView === 'directCosts'}
                onSelect={() => setExpandedView(expandedView === 'directCosts' ? null : 'directCosts')}
              />
              <DataCard
                title="Cost Codes"
                count={procoreData.costCodes?.length || 0}
                bgColor="bg-gray-50"
                textColor="text-gray-900"
                isSelected={expandedView === 'costCodes'}
                onSelect={() => setExpandedView(expandedView === 'costCodes' ? null : 'costCodes')}
              />
            </div>

            {/* Large Table View - Shows below cards when one is selected */}
            {expandedView && (
              <div className="mt-4">
                {expandedView === 'vendors' && (
                  <DataTable
                    title="Vendors"
                    data={procoreData.vendors || []}
                    columns={[
                      { key: 'name', label: 'Name' },
                      { key: 'company', label: 'Company' },
                      { key: 'email_address', label: 'Email' },
                      { key: 'business_phone', label: 'Phone' },
                    ]}
                  />
                )}
                {expandedView === 'subcontracts' && (
                  <DataTable
                    title="Subcontracts"
                    data={procoreData.commitments?.subcontracts || []}
                    columns={[
                      { key: 'number', label: 'Number' },
                      { key: 'title', label: 'Title' },
                      { key: 'status', label: 'Status' },
                      { key: 'grand_total', label: 'Contract Amount', format: (v) => v ? `$${Number(v).toLocaleString()}` : '-' },
                      { key: 'executed', label: 'Executed' },
                    ]}
                  />
                )}
                {expandedView === 'purchaseOrders' && (
                  <DataTable
                    title="Purchase Orders"
                    data={procoreData.commitments?.purchaseOrders || []}
                    columns={[
                      { key: 'number', label: 'Number' },
                      { key: 'title', label: 'Title' },
                      { key: 'status', label: 'Status' },
                      { key: 'grand_total', label: 'Amount', format: (v) => v ? `$${Number(v).toLocaleString()}` : '-' },
                    ]}
                  />
                )}
                {expandedView === 'primeContract' && (
                  <DataTable
                    title="Prime Contracts"
                    data={procoreData.primeContract || []}
                    columns={[
                      { key: 'number', label: 'Number' },
                      { key: 'title', label: 'Title' },
                      { key: 'status', label: 'Status' },
                      { key: 'grand_total', label: 'Contract Value', format: (v) => v ? `$${Number(v).toLocaleString()}` : '-' },
                    ]}
                  />
                )}
                {expandedView === 'subInvoices' && (
                  <DataTable
                    title="Subcontractor Invoices"
                    data={procoreData.subInvoices || []}
                    columns={[
                      { key: 'number', label: 'Invoice #' },
                      { key: 'origin_id', label: 'Origin ID' },
                      { key: 'status', label: 'Status' },
                      { key: 'payment_due', label: 'Amount Due', format: (v) => v ? `$${Number(v).toLocaleString()}` : '-' },
                      { key: 'billing_date', label: 'Billing Date' },
                    ]}
                  />
                )}
                {expandedView === 'paymentApplications' && (
                  <DataTable
                    title="Payment Applications (Billings to Owner)"
                    data={procoreData.paymentApplications || []}
                    columns={[
                      { key: 'number', label: 'App #' },
                      { key: 'status', label: 'Status' },
                      { key: 'billing_date', label: 'Billing Date' },
                      { key: 'total_amount', label: 'Total Amount', format: (v) => v ? `$${Number(v).toLocaleString()}` : '-' },
                    ]}
                  />
                )}
                {expandedView === 'changeOrders' && (
                  <DataTable
                    title="Change Orders"
                    data={[...(procoreData.changeOrders?.commitment || []), ...(procoreData.changeOrders?.prime || [])]}
                    columns={[
                      { key: 'number', label: 'CO #' },
                      { key: 'title', label: 'Title' },
                      { key: 'status', label: 'Status' },
                      { key: 'grand_total', label: 'Amount', format: (v) => v ? `$${Number(v).toLocaleString()}` : '-' },
                    ]}
                  />
                )}
                {expandedView === 'directCosts' && (
                  <DataTable
                    title="Direct Costs"
                    data={procoreData.directCosts || []}
                    columns={[
                      { key: 'description', label: 'Description' },
                      { key: 'direct_cost_date', label: 'Date' },
                      { key: 'invoice_number', label: 'Invoice #' },
                      { key: 'amount', label: 'Amount', format: (v) => v ? `$${Number(v).toLocaleString()}` : '-' },
                      { key: 'status', label: 'Status' },
                    ]}
                  />
                )}
                {expandedView === 'costCodes' && (
                  <DataTable
                    title="Cost Codes"
                    data={procoreData.costCodes || []}
                    columns={[
                      { key: 'full_code', label: 'Code' },
                      { key: 'name', label: 'Name' },
                      { key: 'parent', label: 'Parent', format: (v) => v?.full_code || '-' },
                    ]}
                  />
                )}
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => {
                setStep('select')
                setProcoreData(null)
              }}
              className="px-4 py-2 text-gray-600 hover:text-gray-900"
            >
              Back to Select
            </button>
            <button
              onClick={fetchQuickBooksData}
              className="flex items-center px-6 py-3 bg-procore-blue text-white rounded-lg hover:bg-blue-700"
            >
              <Play className="w-5 h-5 mr-2" />
              Fetch QuickBooks Data
            </button>
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
