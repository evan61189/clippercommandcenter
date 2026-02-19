import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  PauseCircle,
  ArrowRight,
  FileText,
  DollarSign,
  Trash2,
  X,
  Loader2,
} from 'lucide-react'
import {
  getSoftClosedProjects,
  removeSoftClose,
  isSupabaseConfigured,
  getFinancialTailsForProject,
} from '../lib/supabase'
import type { ReconciliationResult, Commitment, ReconciliationReport } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

type ModalType = 'open_aps' | 'open_ars' | 'pending_invoices' | null

interface FinancialTailData {
  projectId: string
  projectName: string
  report: ReconciliationReport
  results: ReconciliationResult[]
  commitments: Commitment[]
}

// Derive the financial tail items from report data
function getOpenAPs(data: FinancialTailData) {
  // Prefer backend-computed open AP items (from actual QB bill balances)
  const aiAnalysis = data.report.ai_analysis as any
  if (aiAnalysis?.open_ap_items && aiAnalysis.open_ap_items.length > 0) {
    return aiAnalysis.open_ap_items
  }
  if (aiAnalysis && aiAnalysis.open_ap_count === 0) {
    return []
  }
  // Fallback: client-side cross-reference
  const matchedInvoices = data.results.filter(r => r.item_type === 'invoice' && r.qb_ref)
  return matchedInvoices.filter(r => {
    const commitment = data.commitments.find(c =>
      c.vendor && r.vendor &&
      c.vendor.toLowerCase().trim() === r.vendor.toLowerCase().trim()
    )
    if (!commitment) return true
    return (commitment.paid_to_date || 0) < (commitment.billed_to_date || 0) - 0.01
  })
}

function getOpenARs(data: FinancialTailData) {
  return data.results.filter(r => r.item_type === 'payment_app' && r.severity !== 'info')
}

function getPendingInvoices(data: FinancialTailData) {
  return data.commitments.filter(c =>
    (c.retention_held || 0) > 0 ||
    (c.current_value || 0) > (c.billed_to_date || 0) + 0.01
  )
}

export default function SoftClosedProjects() {
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [activeModal, setActiveModal] = useState<ModalType>(null)
  const [tailData, setTailData] = useState<FinancialTailData[]>([])
  const [loadingTails, setLoadingTails] = useState(false)

  const { data: softClosedProjects, isLoading, refetch } = useQuery({
    queryKey: ['soft-closed-projects'],
    queryFn: getSoftClosedProjects,
    enabled: isSupabaseConfigured,
  })

  async function handleRemoveSoftClose(projectId: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    if (!confirm('Are you sure you want to remove this project from soft closed status?')) {
      return
    }

    setRemovingId(projectId)
    try {
      await removeSoftClose(projectId)
      refetch()
    } catch (error) {
      console.error('Error removing soft close:', error)
      alert('Failed to remove soft close status. Please try again.')
    } finally {
      setRemovingId(null)
    }
  }

  async function handleKPIClick(type: ModalType) {
    if (!softClosedProjects || softClosedProjects.length === 0) return

    setActiveModal(type)
    setLoadingTails(true)
    try {
      const results = await Promise.all(
        softClosedProjects.map(async (sc) => {
          try {
            const data = await getFinancialTailsForProject(sc.project_id)
            if (!data) return null
            return {
              projectId: sc.project_id,
              projectName: sc.projects?.name || 'Unknown Project',
              ...data,
            } as FinancialTailData
          } catch {
            return null
          }
        })
      )
      setTailData(results.filter(Boolean) as FinancialTailData[])
    } catch (error) {
      console.error('Error fetching financial tails:', error)
    } finally {
      setLoadingTails(false)
    }
  }

  function closeModal() {
    setActiveModal(null)
    setTailData([])
  }

  const totalOpenAps = softClosedProjects?.reduce((sum, p) => sum + (p.open_aps || 0), 0) || 0
  const totalOpenArs = softClosedProjects?.reduce((sum, p) => sum + (p.open_ars || 0), 0) || 0
  const totalPending = softClosedProjects?.reduce((sum, p) => sum + (p.pending_invoices || 0), 0) || 0

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Soft Closed Projects</h1>
        <p className="mt-1 text-sm text-gray-500">
          Projects that have reached substantial completion but have outstanding financial tails
        </p>
      </div>

      {/* Info Banner */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-start">
          <PauseCircle className="w-5 h-5 text-yellow-500 mt-0.5 mr-3" />
          <div>
            <h3 className="text-sm font-medium text-yellow-800">What is Soft Close?</h3>
            <p className="text-sm text-yellow-700 mt-1">
              Soft Closed projects are substantially complete but still have pending financials.
              This may include open accounts payable, open accounts receivable, or invoices that
              subcontractors still need to submit. Once all financials are settled, projects can
              move to Hard Close.
            </p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {softClosedProjects && softClosedProjects.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="card text-center">
            <p className="text-sm text-gray-500">Soft Closed Projects</p>
            <p className="text-2xl font-semibold text-yellow-600">{softClosedProjects.length}</p>
          </div>
          <button
            onClick={() => handleKPIClick('open_aps')}
            className="card text-center hover:shadow-lg hover:border-orange-300 transition-all cursor-pointer border-2 border-transparent"
          >
            <p className="text-sm text-gray-500">Total Open APs</p>
            <p className="text-2xl font-semibold text-orange-600">{totalOpenAps}</p>
            {totalOpenAps > 0 && <p className="text-xs text-gray-400 mt-1">Click to view details</p>}
          </button>
          <button
            onClick={() => handleKPIClick('open_ars')}
            className="card text-center hover:shadow-lg hover:border-blue-300 transition-all cursor-pointer border-2 border-transparent"
          >
            <p className="text-sm text-gray-500">Total Open ARs</p>
            <p className="text-2xl font-semibold text-blue-600">{totalOpenArs}</p>
            {totalOpenArs > 0 && <p className="text-xs text-gray-400 mt-1">Click to view details</p>}
          </button>
          <button
            onClick={() => handleKPIClick('pending_invoices')}
            className="card text-center hover:shadow-lg hover:border-purple-300 transition-all cursor-pointer border-2 border-transparent"
          >
            <p className="text-sm text-gray-500">Pending Invoices</p>
            <p className="text-2xl font-semibold text-purple-600">{totalPending}</p>
            {totalPending > 0 && <p className="text-xs text-gray-400 mt-1">Click to view details</p>}
          </button>
        </div>
      )}

      {/* Projects List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-procore-blue"></div>
        </div>
      ) : softClosedProjects && softClosedProjects.length > 0 ? (
        <div className="space-y-4">
          {softClosedProjects.map((softClosed) => (
            <Link
              key={softClosed.id}
              to={`/project/${softClosed.project_id}`}
              className="block card hover:shadow-lg transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="bg-yellow-100 rounded-lg p-3">
                    <PauseCircle className="w-6 h-6 text-yellow-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {softClosed.projects?.name || 'Unknown Project'}
                    </h3>
                    <p className="text-sm text-gray-500">
                      Soft closed {formatDate(softClosed.soft_closed_at)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-6">
                  {/* Outstanding Items */}
                  <div className="flex items-center space-x-4 text-sm">
                    {(softClosed.open_aps || 0) > 0 && (
                      <div className="flex items-center text-orange-600">
                        <DollarSign className="w-4 h-4 mr-1" />
                        <span>{softClosed.open_aps} Open APs</span>
                      </div>
                    )}
                    {(softClosed.open_ars || 0) > 0 && (
                      <div className="flex items-center text-blue-600">
                        <DollarSign className="w-4 h-4 mr-1" />
                        <span>{softClosed.open_ars} Open ARs</span>
                      </div>
                    )}
                    {(softClosed.pending_invoices || 0) > 0 && (
                      <div className="flex items-center text-purple-600">
                        <FileText className="w-4 h-4 mr-1" />
                        <span>{softClosed.pending_invoices} Pending</span>
                      </div>
                    )}
                  </div>

                  {softClosed.notes && (
                    <div className="max-w-xs text-sm text-gray-500 truncate" title={softClosed.notes}>
                      {softClosed.notes}
                    </div>
                  )}

                  <button
                    onClick={(e) => handleRemoveSoftClose(softClosed.project_id, e)}
                    disabled={removingId === softClosed.project_id}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                    title="Remove from Soft Closed"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <ArrowRight className="w-5 h-5 text-gray-400" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card text-center py-12">
          <PauseCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">No Soft Closed Projects</h3>
          <p className="text-gray-500 mt-1 mb-4">
            Projects that reach substantial completion can be soft closed from the Project Closeout page
          </p>
          <Link
            to="/project-closeouts"
            className="inline-flex items-center px-4 py-2 bg-procore-blue text-white rounded-lg hover:bg-blue-700"
          >
            Go to Project Closeouts
          </Link>
        </div>
      )}

      {/* Detail Modal */}
      {activeModal && (
        <FinancialTailModal
          type={activeModal}
          data={tailData}
          loading={loadingTails}
          onClose={closeModal}
        />
      )}
    </div>
  )
}

function FinancialTailModal({
  type,
  data,
  loading,
  onClose,
}: {
  type: ModalType
  data: FinancialTailData[]
  loading: boolean
  onClose: () => void
}) {
  if (!type) return null

  const config = {
    open_aps: {
      title: 'Open Accounts Payable',
      description: 'QB bills with outstanding balance across all soft-closed projects',
      color: 'orange',
      icon: DollarSign,
    },
    open_ars: {
      title: 'Open Accounts Receivable',
      description: 'Customer invoices with outstanding balance or unmatched pay apps',
      color: 'blue',
      icon: DollarSign,
    },
    pending_invoices: {
      title: 'Pending Invoices',
      description: 'Commitments with retainage held or unbilled amounts remaining',
      color: 'purple',
      icon: FileText,
    },
  }[type]

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" onClick={onClose}>
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="fixed inset-0 bg-black/50" />
        <div
          className="relative bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[85vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between rounded-t-xl z-10">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{config.title}</h3>
              <p className="text-sm text-gray-500">{config.description}</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <div className="p-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
                <span className="ml-3 text-gray-500">Loading financial details...</span>
              </div>
            ) : data.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No data available</p>
            ) : (
              <div className="space-y-6">
                {data.map((project) => {
                  const items = type === 'open_aps'
                    ? getOpenAPs(project)
                    : type === 'open_ars'
                    ? getOpenARs(project)
                    : getPendingInvoices(project)

                  if (type === 'pending_invoices') {
                    const commits = items as Commitment[]
                    if (commits.length === 0) return null
                    return (
                      <ProjectSection key={project.projectId} name={project.projectName} projectId={project.projectId} color={config.color}>
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-2 pr-4 font-medium text-gray-500">Vendor</th>
                              <th className="text-right py-2 px-4 font-medium text-gray-500">Contract Value</th>
                              <th className="text-right py-2 px-4 font-medium text-gray-500">Billed to Date</th>
                              <th className="text-right py-2 px-4 font-medium text-gray-500">Retainage Held</th>
                              <th className="text-right py-2 pl-4 font-medium text-gray-500">Remaining to Bill</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {commits.map((c) => (
                              <tr key={c.id} className="hover:bg-gray-50">
                                <td className="py-2 pr-4 text-gray-900 font-medium">{c.vendor}</td>
                                <td className="py-2 px-4 text-right">{formatCurrency(c.current_value)}</td>
                                <td className="py-2 px-4 text-right">{formatCurrency(c.billed_to_date)}</td>
                                <td className="py-2 px-4 text-right text-orange-600">{formatCurrency(c.retention_held)}</td>
                                <td className="py-2 pl-4 text-right font-medium text-purple-600">
                                  {formatCurrency((c.current_value || 0) - (c.billed_to_date || 0))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </ProjectSection>
                    )
                  }

                  if (type === 'open_aps') {
                    // Open APs — items may be backend open_ap_items or reconciliation results
                    const apItems = items as any[]
                    if (apItems.length === 0) return null
                    return (
                      <ProjectSection key={project.projectId} name={project.projectName} projectId={project.projectId} color={config.color}>
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-2 pr-4 font-medium text-gray-500">Vendor</th>
                              <th className="text-left py-2 px-4 font-medium text-gray-500">QB Bill</th>
                              <th className="text-left py-2 px-4 font-medium text-gray-500">Date</th>
                              <th className="text-right py-2 px-4 font-medium text-gray-500">Amount</th>
                              <th className="text-right py-2 px-4 font-medium text-gray-500">Paid</th>
                              <th className="text-right py-2 px-4 font-medium text-gray-500">Outstanding</th>
                              {apItems.some((r: any) => r.retention_held > 0) && (
                                <th className="text-right py-2 pl-4 font-medium text-gray-500">Retainage</th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {apItems.map((r: any, idx: number) => {
                              const paid = r.paid ?? (r.amount != null && r.balance != null ? r.amount - r.balance : null)
                              return (
                                <tr key={r.id || r.bill_ref || idx} className="hover:bg-gray-50">
                                  <td className="py-2 pr-4 text-gray-900 font-medium">
                                    {r.vendor || r.item_description || '-'}
                                  </td>
                                  <td className="py-2 px-4 text-gray-600">{r.bill_ref || r.qb_ref || '-'}</td>
                                  <td className="py-2 px-4 text-gray-500 text-xs">{r.date || '-'}</td>
                                  <td className="py-2 px-4 text-right">
                                    {r.amount != null ? formatCurrency(r.amount) : r.procore_value != null ? formatCurrency(r.procore_value) : '-'}
                                  </td>
                                  <td className="py-2 px-4 text-right text-green-600">
                                    {paid != null ? formatCurrency(paid) : '-'}
                                  </td>
                                  <td className="py-2 px-4 text-right font-medium text-orange-600">
                                    {r.balance != null ? formatCurrency(r.balance) : r.qb_value != null ? formatCurrency(r.qb_value) : '-'}
                                  </td>
                                  {apItems.some((i: any) => i.retention_held > 0) && (
                                    <td className="py-2 pl-4 text-right text-orange-500">
                                      {r.retention_held != null && r.retention_held > 0 ? formatCurrency(r.retention_held) : '-'}
                                    </td>
                                  )}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </ProjectSection>
                    )
                  }

                  // Open ARs — show reconciliation results
                  const results = items as ReconciliationResult[]
                  if (results.length === 0) return null
                  return (
                    <ProjectSection key={project.projectId} name={project.projectName} projectId={project.projectId} color={config.color}>
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 pr-4 font-medium text-gray-500">Description</th>
                            <th className="text-left py-2 px-4 font-medium text-gray-500">QB Invoice</th>
                            <th className="text-right py-2 px-4 font-medium text-gray-500">Procore Amt</th>
                            <th className="text-right py-2 px-4 font-medium text-gray-500">QB Amt</th>
                            <th className="text-left py-2 pl-4 font-medium text-gray-500">Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {results.map((r) => (
                            <tr key={r.id} className="hover:bg-gray-50">
                              <td className="py-2 pr-4 text-gray-900 font-medium">
                                {r.vendor || r.item_description || '-'}
                              </td>
                              <td className="py-2 px-4 text-gray-600">{r.qb_ref || '-'}</td>
                              <td className="py-2 px-4 text-right">
                                {r.procore_value != null ? formatCurrency(r.procore_value) : '-'}
                              </td>
                              <td className="py-2 px-4 text-right">
                                {r.qb_value != null ? formatCurrency(r.qb_value) : '-'}
                              </td>
                              <td className="py-2 pl-4 text-gray-500 text-xs max-w-xs truncate" title={r.notes || ''}>
                                {r.notes || '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </ProjectSection>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ProjectSection({
  name,
  projectId,
  color,
  children,
}: {
  name: string
  projectId: string
  color: string
  children: React.ReactNode
}) {
  const borderColor = color === 'orange' ? 'border-orange-200' : color === 'blue' ? 'border-blue-200' : 'border-purple-200'
  const bgColor = color === 'orange' ? 'bg-orange-50' : color === 'blue' ? 'bg-blue-50' : 'bg-purple-50'
  const textColor = color === 'orange' ? 'text-orange-800' : color === 'blue' ? 'text-blue-800' : 'text-purple-800'

  return (
    <div className={`border ${borderColor} rounded-lg overflow-hidden`}>
      <div className={`${bgColor} px-4 py-3 flex items-center justify-between`}>
        <h4 className={`font-semibold ${textColor}`}>{name}</h4>
        <Link
          to={`/project/${projectId}`}
          className={`text-xs ${textColor} hover:underline`}
          onClick={(e) => e.stopPropagation()}
        >
          View Project
        </Link>
      </div>
      <div className="p-4 overflow-x-auto">
        {children}
      </div>
    </div>
  )
}
