import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, FileQuestion, ClipboardList, CheckSquare,
  ChevronRight, Plug, RefreshCw, Loader2
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

interface ActiveProject {
  project_id: string
  code: string
  project_name: string
  status: string
  procore_stage: string | null
  revised_contract_value: number
  total_committed: number
  total_billed: number
  total_cost: number
  gross_margin_percent: number
  over_under_billing: number
  retainage_held: number
  pending_co_amount: number
  pending_co_count: number
  open_rfis: number
  oldest_rfi_days: number
  open_submittals: number
  open_punch_items: number
  closed_punch_items: number
  general_conditions: number
}

const fmt = (val: number | null | undefined) => {
  if (val == null) return '$0'
  const abs = Math.abs(val)
  if (abs >= 1_000_000) return `${val < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${val < 0 ? '-' : ''}$${(abs / 1_000).toFixed(0)}K`
  return `$${val.toLocaleString()}`
}

function RiskBadges({ project }: { project: ActiveProject }) {
  const badges: { icon: any; label: string; color: string }[] = []

  if (project.open_rfis > 0) {
    badges.push({
      icon: FileQuestion,
      label: `${project.open_rfis} RFI${project.open_rfis > 1 ? 's' : ''}`,
      color: project.oldest_rfi_days > 14 ? 'text-red-600 bg-red-50' : 'text-amber-600 bg-amber-50',
    })
  }
  if (project.open_submittals > 0) {
    badges.push({
      icon: ClipboardList,
      label: `${project.open_submittals} Sub`,
      color: 'text-blue-600 bg-blue-50',
    })
  }
  if (project.open_punch_items > 0) {
    badges.push({
      icon: CheckSquare,
      label: `${project.open_punch_items} Punch`,
      color: 'text-purple-600 bg-purple-50',
    })
  }
  if (project.total_committed > project.revised_contract_value && project.revised_contract_value > 0) {
    badges.push({
      icon: AlertTriangle,
      label: 'Over committed',
      color: 'text-red-600 bg-red-50',
    })
  }

  if (badges.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((b, i) => (
        <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${b.color}`}>
          <b.icon className="w-3 h-3" />
          {b.label}
        </span>
      ))}
    </div>
  )
}

function BilledBar({ billed, contract }: { billed: number; contract: number }) {
  if (contract <= 0) return <span className="text-xs text-gray-400">—</span>
  const pct = Math.min((billed / contract) * 100, 100)
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 bg-gray-200 rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full ${pct >= 90 ? 'bg-emerald-500' : pct >= 50 ? 'bg-clipper-gold' : 'bg-blue-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 w-10 text-right">{pct.toFixed(0)}%</span>
    </div>
  )
}

export default function CompanyOverview() {
  const [projects, setProjects] = useState<ActiveProject[]>([])
  const [loading, setLoading] = useState(true)
  const [hasProcore, setHasProcore] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const { user } = useAuth()
  const userId = user?.id || 'anonymous'

  useEffect(() => {
    loadProjects()
  }, [])

  async function loadProjects() {
    setLoading(true)
    try {
      // Check Procore connection
      const { data: creds } = await supabase.from('api_credentials').select('provider')
      setHasProcore(creds?.some(c => c.provider === 'procore') || false)

      // Load WIP data — filter to active projects with a prime contract
      const { data, error } = await supabase
        .from('wip_schedule')
        .select('*')
        .gt('revised_contract_value', 0)
        .order('revised_contract_value', { ascending: false })

      if (error) throw error

      // Filter to <100% billed
      const active = (data || []).filter((p: ActiveProject) => {
        if (p.revised_contract_value <= 0) return false
        const billedPct = p.total_billed / p.revised_contract_value
        return billedPct < 1
      })

      setProjects(active)
    } catch (err) {
      console.error('Failed to load projects:', err)
    } finally {
      setLoading(false)
    }
  }

  async function runSync() {
    setSyncing(true)
    setSyncMsg('Syncing from Procore...')
    try {
      const res = await fetch('/.netlify/functions/procore-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Sync failed')

      const s = result.synced || {}
      const parts = []
      if (s.projects) parts.push(`${s.projects} projects`)
      if (s.contracts) parts.push(`${s.contracts} contracts`)
      if (s.subcontracts) parts.push(`${s.subcontracts} subs`)
      if (s.change_orders) parts.push(`${s.change_orders} COs`)
      if (s.pay_apps) parts.push(`${s.pay_apps} pay apps`)
      setSyncMsg(`Synced: ${parts.join(', ')}`)
      setTimeout(() => setSyncMsg(null), 8000)
      loadProjects()
    } catch (err: any) {
      setSyncMsg(`Sync error: ${err.message}`)
      setTimeout(() => setSyncMsg(null), 8000)
    } finally {
      setSyncing(false)
    }
  }

  // Summary stats
  const totalContract = projects.reduce((s, p) => s + (p.revised_contract_value || 0), 0)
  const totalBilled = projects.reduce((s, p) => s + (p.total_billed || 0), 0)
  const totalCommitted = projects.reduce((s, p) => s + (p.total_committed || 0), 0)
  const totalOpenItems = projects.reduce((s, p) => s + (p.open_rfis || 0) + (p.open_submittals || 0) + (p.open_punch_items || 0), 0)
  const totalGC = projects.reduce((s, p) => s + (parseFloat(String(p.general_conditions)) || 0), 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clipper-gold"></div>
      </div>
    )
  }

  if (!hasProcore) {
    return (
      <div className="max-w-lg mx-auto mt-20 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Plug className="w-8 h-8 text-gray-400" />
        </div>
        <h2 className="text-xl font-bold text-clipper-black mb-2">Connect Procore</h2>
        <p className="text-sm text-gray-500 mb-6">
          Connect your Procore account to pull active project data into the Command Terminal.
        </p>
        <Link to="/settings" className="px-5 py-2.5 bg-clipper-gold text-clipper-black font-semibold rounded-lg hover:bg-clipper-gold-dark transition-colors">
          Go to Settings
        </Link>
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="max-w-lg mx-auto mt-20 text-center">
        <h2 className="text-xl font-bold text-clipper-black mb-2">No Active Projects</h2>
        <p className="text-sm text-gray-500 mb-6">
          No projects with a prime contract and less than 100% billed were found. Try syncing from Procore.
        </p>
        <button onClick={runSync} disabled={syncing} className="px-5 py-2.5 bg-clipper-gold text-clipper-black font-semibold rounded-lg hover:bg-clipper-gold-dark disabled:opacity-50 flex items-center gap-2 mx-auto">
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Sync Now
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-clipper-black">Active Projects</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {projects.length} project{projects.length !== 1 ? 's' : ''} with prime contracts in progress
          </p>
        </div>
        <button
          onClick={runSync}
          disabled={syncing}
          className="px-4 py-2 text-sm font-medium text-clipper-black bg-clipper-gold rounded-lg hover:bg-clipper-gold-dark disabled:opacity-50 flex items-center gap-1.5 transition-colors"
        >
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Sync
        </button>
      </div>

      {/* Sync message */}
      {syncMsg && (
        <div className="px-4 py-2.5 rounded-lg border bg-green-50 border-green-200 text-green-700 text-sm">
          {syncing && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}
          {syncMsg}
        </div>
      )}

      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Contract</p>
          <p className="text-xl font-bold text-clipper-black mt-0.5">{fmt(totalContract)}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Billed</p>
          <p className="text-xl font-bold text-clipper-black mt-0.5">{totalBilled > 0 ? fmt(totalBilled) : '—'}</p>
          {totalBilled > 0 && totalContract > 0 && (
            <p className="text-xs text-gray-400">{((totalBilled / totalContract) * 100).toFixed(0)}% of contract</p>
          )}
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Committed</p>
          <p className="text-xl font-bold text-clipper-black mt-0.5">{totalCommitted > 0 ? fmt(totalCommitted) : '—'}</p>
          {totalCommitted > 0 && totalContract > 0 && (
            <p className="text-xs text-gray-400">{((totalCommitted / totalContract) * 100).toFixed(0)}% of contract</p>
          )}
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Gen. Conditions</p>
          <p className="text-xl font-bold text-clipper-black mt-0.5">{totalGC > 0 ? fmt(totalGC) : '—'}</p>
          <p className="text-xs text-gray-400">PM, APM, Super labor</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Open Items</p>
          <p className="text-xl font-bold text-clipper-black mt-0.5">{totalOpenItems}</p>
          <p className="text-xs text-gray-400">RFIs, submittals, punch</p>
        </div>
      </div>

      {/* Project list */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Project</th>
              <th className="text-right py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Contract</th>
              <th className="text-right py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Committed</th>
              <th className="text-center py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Billed</th>
              <th className="text-right py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Margin</th>
              <th className="text-right py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">GC</th>
              <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Flags</th>
              <th className="py-3 px-3 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const margin = p.gross_margin_percent || 0
              const hasMargin = margin !== 0
              const committedPct = p.revised_contract_value > 0 ? (p.total_committed / p.revised_contract_value) * 100 : 0
              const overCommitted = committedPct > 100

              return (
                <tr key={p.project_id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4">
                    <Link to={`/projects/${p.project_id}`} className="group">
                      <p className="font-semibold text-clipper-black group-hover:text-clipper-gold-dark transition-colors">
                        {p.project_name}
                      </p>
                      {p.code && <p className="text-xs text-gray-400">{p.code}</p>}
                    </Link>
                  </td>
                  <td className="py-3 px-3 text-right font-medium text-gray-900">
                    {fmt(p.revised_contract_value)}
                  </td>
                  <td className={`py-3 px-3 text-right font-medium ${overCommitted ? 'text-red-600' : 'text-gray-600'}`}>
                    {p.total_committed > 0 ? fmt(p.total_committed) : '—'}
                    {p.total_committed > 0 && (
                      <span className="block text-xs text-gray-400">{committedPct.toFixed(0)}%</span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    <BilledBar billed={p.total_billed} contract={p.revised_contract_value} />
                  </td>
                  <td className="py-3 px-3 text-right">
                    {hasMargin ? (
                      <span className={`font-semibold ${margin > 10 ? 'text-emerald-600' : margin >= 5 ? 'text-amber-600' : 'text-red-600'}`}>
                        {margin.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right font-medium text-gray-600">
                    {parseFloat(String(p.general_conditions)) > 0 ? fmt(parseFloat(String(p.general_conditions))) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-3 px-3">
                    <RiskBadges project={p} />
                  </td>
                  <td className="py-3 px-3">
                    <Link to={`/projects/${p.project_id}`} className="text-gray-400 hover:text-clipper-gold-dark">
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Footer summary */}
      <div className="flex items-center justify-between text-xs text-gray-400 px-1">
        <span>Showing {projects.length} active projects with prime contracts &lt; 100% billed</span>
        <Link to="/settings" className="hover:text-clipper-gold-dark">Manage Connections</Link>
      </div>
    </div>
  )
}
