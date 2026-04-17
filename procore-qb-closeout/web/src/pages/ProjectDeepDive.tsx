import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, DollarSign, Calendar, AlertTriangle, CheckCircle2, FileQuestion, ClipboardList, CheckSquare, Users, TrendingUp, AlertCircle, Mail, ChevronDown, ChevronRight, FileText, RefreshCw, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

// --- Types ---
interface ProjectData {
  id: string; name: string; code: string; status: string;
  original_contract_value: number; current_contract_value: number;
  start_date: string; estimated_completion_date: string; address: any;
  procore_project_id: string;
}
interface PrimeContract { id: string; procore_id: string; title: string; number: string; owner_name: string; status: string; contract_value: number; retainage_percent: number; executed: boolean; }
interface SubContract { id: string; vendor_name: string; title: string; contract_value: number; status: string; trade: string; number: string; }
interface ChangeOrder { id: string; title: string; status: string; amount: number; change_type: string; number: string; }
interface PayApp { id: string; vendor_name: string; amount_due: number; total_completed: number; retainage: number; status: string; number: string; scheduled_value: number; procore_id: string; }
interface RFI { id: string; number: string; subject: string; status: string; due_date: string; created_at: string; priority: string; }
interface Submittal { id: string; number: string; title: string; status: string; due_date: string; required_on_site_date: string; }
interface PunchItem { id: string; name: string; status: string; assigned_to_name: string; due_date: string; priority: string; }
interface BudgetLine { id: string; cost_code: string; description: string; revised_budget: number; committed: number; actual_costs: number; projected_cost: number; over_under: number; }
interface Correspondence { id: string; subject: string; from_name: string; date: string; snippet: string; }

// --- Helpers ---
function fmt(n: number | null | undefined): string {
  if (n == null || n === 0) return '$0'
  if (Math.abs(n) >= 1_000_000) return `${n < 0 ? '-' : ''}$${(Math.abs(n) / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${n < 0 ? '-' : ''}$${(Math.abs(n) / 1_000).toFixed(0)}K`
  return n < 0 ? `-$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function daysAgo(dateStr: string): number {
  if (!dateStr) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000))
}

function daysBetween(start: string, end: string): number {
  if (!start || !end) return 0
  return Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 86400000))
}

function pctComplete(start: string, end: string): number {
  if (!start || !end) return 0
  const total = daysBetween(start, end)
  if (total === 0) return 100
  const elapsed = daysAgo(start)
  return Math.min(100, Math.round((elapsed / total) * 100))
}

// --- Collapsible Section ---
function Section({ title, icon: Icon, badge, defaultOpen = true, children }: {
  title: string; icon: any; badge?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card !py-0 overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-4 py-3 hover:bg-gray-50 transition-colors text-left">
        {open ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
        <Icon className="w-4 h-4 text-clipper-gold shrink-0" />
        <h2 className="text-sm font-semibold text-clipper-black flex-1">{title}</h2>
        {badge && <span className="text-xs text-gray-400">{badge}</span>}
      </button>
      {open && <div className="px-4 pb-4 border-t border-gray-50">{children}</div>}
    </div>
  )
}

// --- Component ---
export default function ProjectDeepDive() {
  const { projectId } = useParams()
  const { user } = useAuth()
  const [project, setProject] = useState<ProjectData | null>(null)
  const [primes, setPrimes] = useState<PrimeContract[]>([])
  const [subs, setSubs] = useState<SubContract[]>([])
  const [cos, setCos] = useState<ChangeOrder[]>([])
  const [payApps, setPayApps] = useState<PayApp[]>([])
  const [rfis, setRfis] = useState<RFI[]>([])
  const [submittals, setSubmittals] = useState<Submittal[]>([])
  const [punch, setPunch] = useState<PunchItem[]>([])
  const [budget, setBudget] = useState<BudgetLine[]>([])
  const [emails, setEmails] = useState<Correspondence[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [showAllSubs, setShowAllSubs] = useState(false)
  const [showAllUncommitted, setShowAllUncommitted] = useState(false)

  useEffect(() => {
    if (!projectId) return
    async function load() {
      const [projRes, primesRes, subsRes, cosRes, paRes, rfiRes, subRes, punchRes, budgetRes] = await Promise.all([
        supabase.from('projects').select('*').eq('id', projectId).single(),
        supabase.from('prime_contracts').select('*').eq('project_id', projectId).order('contract_value', { ascending: false }),
        supabase.from('subcontracts').select('*').eq('project_id', projectId).order('contract_value', { ascending: false }),
        supabase.from('procore_change_orders').select('*').eq('project_id', projectId),
        supabase.from('procore_pay_apps').select('*').eq('project_id', projectId),
        supabase.from('rfis').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
        supabase.from('submittals').select('*').eq('project_id', projectId),
        supabase.from('punch_items').select('*').eq('project_id', projectId),
        supabase.from('procore_budget').select('*').eq('project_id', projectId),
      ])
      if (projRes.data) setProject(projRes.data)
      if (primesRes.data) setPrimes(primesRes.data)
      if (subsRes.data) setSubs(subsRes.data)
      if (cosRes.data) setCos(cosRes.data)
      if (paRes.data) setPayApps(paRes.data)
      if (rfiRes.data) setRfis(rfiRes.data)
      if (subRes.data) setSubmittals(subRes.data)
      if (punchRes.data) setPunch(punchRes.data)
      if (budgetRes.data) setBudget(budgetRes.data)

      // Fetch correspondence from Procore API
      if (projRes.data?.procore_project_id && user?.id) {
        try {
          const res = await fetch('/.netlify/functions/procore-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'getEmails', projectId: projRes.data.procore_project_id, userId: user.id }),
          })
          if (res.ok) {
            const data = await res.json()
            if (Array.isArray(data)) setEmails(data.slice(0, 8))
          }
        } catch { /* emails are supplementary */ }
      }

      setLoading(false)
    }
    load()
  }, [projectId, user?.id])

  async function syncProject() {
    if (!projectId || !user?.id) return
    setSyncing(true)
    try {
      const res = await fetch('/.netlify/functions/procore-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, action: 'sync_project', projectId }),
      })
      if (res.ok) {
        // Reload all data
        const [primesRes, subsRes, cosRes, paRes, rfiRes, subRes, punchRes, budgetRes] = await Promise.all([
          supabase.from('prime_contracts').select('*').eq('project_id', projectId).order('contract_value', { ascending: false }),
          supabase.from('subcontracts').select('*').eq('project_id', projectId).order('contract_value', { ascending: false }),
          supabase.from('procore_change_orders').select('*').eq('project_id', projectId),
          supabase.from('procore_pay_apps').select('*').eq('project_id', projectId),
          supabase.from('rfis').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
          supabase.from('submittals').select('*').eq('project_id', projectId),
          supabase.from('punch_items').select('*').eq('project_id', projectId),
          supabase.from('procore_budget').select('*').eq('project_id', projectId),
        ])
        if (primesRes.data) setPrimes(primesRes.data)
        if (subsRes.data) setSubs(subsRes.data)
        if (cosRes.data) setCos(cosRes.data)
        if (paRes.data) setPayApps(paRes.data)
        if (rfiRes.data) setRfis(rfiRes.data)
        if (subRes.data) setSubmittals(subRes.data)
        if (punchRes.data) setPunch(punchRes.data)
        if (budgetRes.data) setBudget(budgetRes.data)
      }
    } catch (err) {
      console.error('Sync failed:', err)
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clipper-gold" /></div>
  }
  if (!project) {
    return <div className="text-center py-16 text-gray-500">Project not found</div>
  }

  // --- Computed values ---
  // Sum contract value from prime_contracts table (more reliable than project field
  // since Procore's /prime_contract endpoint may only return one)
  const primesTotal = primes.reduce((s, pc) => s + (pc.contract_value || 0), 0)
  const contractValue = primesTotal > 0 ? primesTotal : (project.current_contract_value || project.original_contract_value || 0)
  const totalCommitted = subs.reduce((s, c) => s + (c.contract_value || 0), 0)
  const ownerPayApps = payApps.filter(p => p.vendor_name === '__OWNER__')
  const subInvoices = payApps.filter(p => p.vendor_name !== '__OWNER__')
  const totalBilled = ownerPayApps.reduce((s, p) => s + (p.amount_due || 0), 0)
  const totalRetainage = ownerPayApps.reduce((s, p) => s + (p.retainage || 0), 0)
  const totalSubCost = subInvoices.reduce((s, p) => s + (p.amount_due || 0), 0)
  const budgetActualCost = budget.reduce((s, b) => s + (b.actual_costs || 0), 0)
  const totalCost = totalSubCost > 0 ? totalSubCost : budgetActualCost
  const margin = contractValue > 0 && totalCost > 0 ? ((contractValue - totalCost) / contractValue) * 100 : null
  const overUnder = totalBilled - totalCost
  const billedPct = contractValue > 0 ? Math.min(100, (totalBilled / contractValue) * 100) : 0
  const committedPct = contractValue > 0 ? Math.min(100, (totalCommitted / contractValue) * 100) : 0

  const pendingPrimeCOs = cos.filter(c => c.change_type === 'prime' && !['approved', 'closed', 'rejected', 'void'].includes(c.status?.toLowerCase()))
  const pendingCommitCOs = cos.filter(c => c.change_type === 'commitment' && !['approved', 'closed', 'rejected', 'void'].includes(c.status?.toLowerCase()))
  const pendingCOTotal = pendingPrimeCOs.reduce((s, c) => s + (c.amount || 0), 0)

  const openRfis = rfis.filter(r => !['closed', 'Closed'].includes(r.status))
  const openSubmittals = submittals.filter(s => !['closed', 'Closed', 'Approved', 'approved'].includes(s.status))
  const openPunch = punch.filter(p => !['Closed', 'closed'].includes(p.status))
  const closedPunch = punch.filter(p => ['Closed', 'closed'].includes(p.status))

  const schedulePct = pctComplete(project.start_date, project.estimated_completion_date)
  const daysRemaining = project.estimated_completion_date ? Math.max(0, Math.floor((new Date(project.estimated_completion_date).getTime() - Date.now()) / 86400000)) : null

  // --- Auto-generated action items ---
  const actions: { icon: any; text: string; urgency: 'red' | 'amber' | 'blue' }[] = []

  if (openRfis.length > 0) {
    const overdueRfis = openRfis.filter(r => r.due_date && new Date(r.due_date) < new Date())
    if (overdueRfis.length > 0) actions.push({ icon: FileQuestion, text: `${overdueRfis.length} overdue RFI${overdueRfis.length > 1 ? 's' : ''} need response`, urgency: 'red' })
    else actions.push({ icon: FileQuestion, text: `${openRfis.length} open RFI${openRfis.length > 1 ? 's' : ''} pending`, urgency: 'amber' })
  }
  if (openSubmittals.length > 0) {
    const overdueSubs = openSubmittals.filter(s => s.due_date && new Date(s.due_date) < new Date())
    if (overdueSubs.length > 0) actions.push({ icon: ClipboardList, text: `${overdueSubs.length} overdue submittal${overdueSubs.length > 1 ? 's' : ''}`, urgency: 'red' })
    else actions.push({ icon: ClipboardList, text: `${openSubmittals.length} submittal${openSubmittals.length > 1 ? 's' : ''} need review`, urgency: 'amber' })
  }
  if (pendingPrimeCOs.length > 0) actions.push({ icon: DollarSign, text: `${pendingPrimeCOs.length} prime CO${pendingPrimeCOs.length > 1 ? 's' : ''} pending (${fmt(pendingCOTotal)})`, urgency: 'amber' })
  if (pendingCommitCOs.length > 0) actions.push({ icon: DollarSign, text: `${pendingCommitCOs.length} commitment CO${pendingCommitCOs.length > 1 ? 's' : ''} to process`, urgency: 'blue' })
  if (openPunch.length > 0) actions.push({ icon: CheckSquare, text: `${openPunch.length} punch item${openPunch.length > 1 ? 's' : ''} open${closedPunch.length > 0 ? ` (${closedPunch.length} closed)` : ''}`, urgency: openPunch.length > 20 ? 'red' : 'amber' })

  // Budget lines without commitments
  const uncommittedLines = budget.filter(b => (b.revised_budget || 0) > 0 && (b.committed || 0) === 0)
  const uncommittedTotal = uncommittedLines.reduce((s, b) => s + (b.revised_budget || 0), 0)
  if (uncommittedLines.length > 0) {
    actions.push({
      icon: DollarSign,
      text: `${uncommittedLines.length} budget line${uncommittedLines.length > 1 ? 's' : ''} without commitment (${fmt(uncommittedTotal)})`,
      urgency: uncommittedTotal > contractValue * 0.1 ? 'red' : 'amber',
    })
  }

  if (actions.length === 0) actions.push({ icon: CheckCircle2, text: 'No critical items — project on track', urgency: 'blue' })

  // Top risks
  const risks: { severity: 'red' | 'amber'; text: string; detail: string }[] = []
  const sortedRfis = [...openRfis].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  for (const rfi of sortedRfis.slice(0, 3)) {
    const age = daysAgo(rfi.created_at)
    if (age > 14) risks.push({ severity: age > 30 ? 'red' : 'amber', text: `RFI #${rfi.number} — ${age} days old`, detail: rfi.subject || 'No subject' })
  }
  const overdueSubmittals = openSubmittals.filter(s => s.due_date && new Date(s.due_date) < new Date())
  for (const sub of overdueSubmittals.slice(0, 2)) {
    risks.push({ severity: 'amber', text: `Submittal #${sub.number} overdue`, detail: sub.title || '' })
  }
  if (contractValue > 0 && totalCommitted > contractValue) {
    risks.push({ severity: 'red', text: 'Committed exceeds contract', detail: `${fmt(totalCommitted)} committed vs ${fmt(contractValue)} contract` })
  }
  if (margin !== null && margin < 10) {
    risks.push({ severity: margin < 0 ? 'red' : 'amber', text: `Margin at ${margin.toFixed(1)}%`, detail: margin < 0 ? 'Project is over budget' : 'Below target margin' })
  }

  const sortedSubs = [...subs].sort((a, b) => (b.contract_value || 0) - (a.contract_value || 0))
  const urgencyColors = { red: 'text-red-600 bg-red-50', amber: 'text-amber-600 bg-amber-50', blue: 'text-blue-600 bg-blue-50' }

  const statusDot = (status: string) => {
    const s = status?.toLowerCase() || ''
    if (['active', 'approved', 'complete'].includes(s)) return 'bg-emerald-500'
    if (['out for signature', 'pending'].includes(s)) return 'bg-amber-400'
    if (s === 'draft') return 'bg-gray-300'
    return 'bg-gray-300'
  }

  return (
    <div className="space-y-4 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/projects" className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              {project.code && <span className="text-xs font-mono text-gray-400">{project.code}</span>}
              <h1 className="text-xl font-bold text-clipper-black">{project.name}</h1>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={syncProject}
            disabled={syncing}
            className="px-3 py-1.5 text-xs font-medium text-clipper-black bg-clipper-gold rounded-lg hover:bg-clipper-gold-dark disabled:opacity-50 flex items-center gap-1 transition-colors"
          >
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
          <span className={`badge ${project.status === 'active' ? 'badge-green' : 'badge-yellow'}`}>{project.status.replace('_', ' ')}</span>
        </div>
      </div>

      {/* Financial Summary Bar */}
      <div className="card !py-4">
        <div className="grid grid-cols-4 md:grid-cols-7 gap-4 text-center">
          <div>
            <div className="text-[10px] font-medium text-gray-400 uppercase">Contract</div>
            <div className="text-lg font-bold">{fmt(contractValue)}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium text-gray-400 uppercase">Committed</div>
            <div className={`text-lg font-bold ${totalCommitted > contractValue ? 'text-red-600' : ''}`}>{totalCommitted > 0 ? fmt(totalCommitted) : '—'}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium text-gray-400 uppercase">Billed</div>
            <div className="text-lg font-bold">{totalBilled > 0 ? fmt(totalBilled) : '—'}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium text-gray-400 uppercase">Cost to Date</div>
            <div className="text-lg font-bold">{totalCost > 0 ? fmt(totalCost) : '—'}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium text-gray-400 uppercase">Over/Under</div>
            <div className={`text-lg font-bold ${totalCost > 0 ? (overUnder >= 0 ? 'text-emerald-600' : 'text-red-600') : 'text-gray-300'}`}>
              {totalCost > 0 ? fmt(overUnder) : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-medium text-gray-400 uppercase">Margin</div>
            <div className={`text-lg font-bold ${margin !== null ? (margin >= 20 ? 'text-emerald-600' : margin >= 10 ? 'text-amber-600' : 'text-red-600') : 'text-gray-300'}`}>
              {margin !== null ? `${margin.toFixed(1)}%` : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-medium text-gray-400 uppercase">Retainage</div>
            <div className="text-lg font-bold">{totalRetainage > 0 ? fmt(totalRetainage) : '—'}</div>
          </div>
        </div>

        {/* Progress bars */}
        {contractValue > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center gap-2 text-[10px] text-gray-400">
              <span className="w-16">Billed</span>
              <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                <div className="bg-emerald-500 h-full rounded-full transition-all" style={{ width: `${billedPct}%` }} />
              </div>
              <span className="w-10 text-right">{billedPct.toFixed(0)}%</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-gray-400">
              <span className="w-16">Committed</span>
              <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${committedPct > 100 ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(committedPct, 100)}%` }} />
              </div>
              <span className="w-10 text-right">{committedPct.toFixed(0)}%</span>
            </div>
          </div>
        )}
      </div>

      {/* Prime Contracts — one section per contract */}
      {primes.length > 0 && (
        <div className="space-y-3">
          {primes.map((pc) => {
            const primeBilled = primes.length === 1
              ? totalBilled
              : null // Can't split billing across primes without Procore linking
            const billedPctPrime = pc.contract_value > 0 && primeBilled !== null
              ? Math.min(100, (primeBilled / pc.contract_value) * 100)
              : null

            return (
              <Section
                key={pc.id}
                title={pc.title || 'Prime Contract'}
                icon={FileText}
                badge={`${fmt(pc.contract_value)} — ${pc.status}`}
                defaultOpen={true}
              >
                <div className="mt-3 space-y-3">
                  {/* Prime contract details */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-sm">
                    <div>
                      <div className="text-[10px] text-gray-400 uppercase">Contract Value</div>
                      <div className="font-bold">{fmt(pc.contract_value)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-400 uppercase">Status</div>
                      <div className="flex items-center justify-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${statusDot(pc.status)}`} />
                        <span className="font-medium">{pc.status}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-400 uppercase">Executed</div>
                      <div className="font-medium">{pc.executed ? 'Yes' : 'No'}</div>
                    </div>
                    {pc.retainage_percent != null && pc.retainage_percent > 0 && (
                      <div>
                        <div className="text-[10px] text-gray-400 uppercase">Retainage</div>
                        <div className="font-medium">{pc.retainage_percent}%</div>
                      </div>
                    )}
                  </div>

                  {/* Billing progress for this prime (only shown for single-prime projects) */}
                  {billedPctPrime !== null && pc.contract_value > 0 && (
                    <div className="flex items-center gap-2 text-[10px] text-gray-400">
                      <span className="w-12">Billed</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${billedPctPrime}%` }} />
                      </div>
                      <span className="w-10 text-right">{billedPctPrime.toFixed(0)}%</span>
                    </div>
                  )}

                  {/* Owner name if present */}
                  {pc.owner_name && (
                    <div className="text-xs text-gray-400">
                      Owner: <span className="text-gray-600">{pc.owner_name}</span>
                    </div>
                  )}
                </div>
              </Section>
            )
          })}
        </div>
      )}

      {/* Main Grid: Schedule + Actions | Risks + Commitments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Left Column */}
        <div className="space-y-4">

          {/* Schedule Snapshot */}
          <Section title="Schedule" icon={Calendar} defaultOpen={true}>
            <div className="mt-3">
              <div className="grid grid-cols-3 gap-3 text-center mb-3">
                <div>
                  <div className="text-[10px] text-gray-400 uppercase">Start</div>
                  <div className="text-sm font-medium">{project.start_date ? new Date(project.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase">End</div>
                  <div className="text-sm font-medium">{project.estimated_completion_date ? new Date(project.estimated_completion_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase">Remaining</div>
                  <div className={`text-sm font-medium ${daysRemaining !== null && daysRemaining < 30 ? 'text-red-600' : ''}`}>
                    {daysRemaining !== null ? `${daysRemaining}d` : '—'}
                  </div>
                </div>
              </div>
              {project.start_date && project.estimated_completion_date && (
                <div>
                  <div className="flex items-center gap-2 text-[10px] text-gray-400 mb-1">
                    <span>Timeline</span>
                    <span className="ml-auto">{schedulePct}% elapsed</span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${schedulePct > 90 ? 'bg-red-500' : schedulePct > 70 ? 'bg-amber-500' : 'bg-clipper-gold'}`}
                      style={{ width: `${schedulePct}%` }} />
                  </div>
                </div>
              )}
              {pendingCOTotal !== 0 && (
                <div className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {fmt(pendingCOTotal)} in pending prime COs could adjust contract
                </div>
              )}
            </div>
          </Section>

          {/* Action Items */}
          <Section title="Action Items" icon={AlertTriangle} badge={`${actions.length}`} defaultOpen={true}>
            <div className="mt-3 space-y-2">
              {actions.map((a, i) => (
                <div key={i} className={`flex items-center gap-2.5 text-sm px-2.5 py-1.5 rounded-lg ${urgencyColors[a.urgency]}`}>
                  <a.icon className="w-4 h-4 shrink-0" />
                  <span>{a.text}</span>
                </div>
              ))}
            </div>
            {/* Uncommitted budget line detail */}
            {uncommittedLines.length > 0 && (() => {
              const visibleLines = showAllUncommitted ? uncommittedLines : uncommittedLines.slice(0, 8)
              return (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-medium text-gray-500">Budget lines without commitment:</p>
                    <p className="text-xs text-gray-400 font-mono">{fmt(uncommittedTotal)} total</p>
                  </div>
                  <div className="space-y-1">
                    {visibleLines.map((b, i) => {
                      const code = b.cost_code && b.cost_code !== 'N/A' ? b.cost_code : null
                      const desc = b.description && b.description !== 'N/A' ? b.description : null
                      const label = code
                        ? `${code}${desc ? ' — ' + desc : ''}`
                        : desc
                        ? desc
                        : `Unassigned budget`
                      return (
                        <div key={i} className="flex items-center justify-between text-xs text-gray-500">
                          <span className="truncate">{label}</span>
                          <span className="font-mono shrink-0 ml-2">{fmt(b.revised_budget)}</span>
                        </div>
                      )
                    })}
                    {uncommittedLines.length > 8 && (
                      <button
                        onClick={() => setShowAllUncommitted(!showAllUncommitted)}
                        className="text-xs text-clipper-gold-dark hover:underline pt-1 w-full text-left"
                      >
                        {showAllUncommitted ? 'Show less' : `+ ${uncommittedLines.length - 8} more budget lines`}
                      </button>
                    )}
                  </div>
                </div>
              )
            })()}
          </Section>

          {/* Top Risks */}
          <Section title="Top Risks" icon={AlertCircle} defaultOpen={risks.length > 0}>
            <div className="mt-3">
              {risks.length === 0 ? (
                <p className="text-sm text-gray-400 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" /> No major risks identified
                </p>
              ) : (
                <div className="space-y-2">
                  {risks.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${r.severity === 'red' ? 'bg-red-500' : 'bg-amber-400'}`} />
                      <div>
                        <span className="font-medium">{r.text}</span>
                        <span className="text-gray-400 ml-1.5">{r.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* Right Column */}
        <div className="space-y-4">

          {/* Commitments / Subcontractors */}
          <Section title="Commitments" icon={Users} badge={`${subs.length} total — ${fmt(totalCommitted)}`} defaultOpen={true}>
            <div className="mt-3">
              {sortedSubs.length === 0 ? (
                <p className="text-sm text-gray-400">No subcontracts synced yet</p>
              ) : (
                <div className="space-y-1">
                  {(showAllSubs ? sortedSubs : sortedSubs.slice(0, 8)).map((sub) => {
                    const displayName = sub.vendor_name && sub.vendor_name !== sub.title
                      ? sub.vendor_name
                      : sub.title || sub.vendor_name || 'Unknown'
                    const subtitle = sub.vendor_name && sub.vendor_name !== sub.title
                      ? sub.title
                      : sub.number || null

                    return (
                      <div key={sub.id} className="flex items-center justify-between py-1.5 text-sm border-b border-gray-50 last:border-0">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(sub.status)}`} />
                          <div className="min-w-0">
                            <span className="truncate font-medium block">{displayName}</span>
                            <div className="flex items-center gap-2">
                              {subtitle && <span className="text-[10px] text-gray-400 truncate">{subtitle}</span>}
                              {sub.trade && <span className="text-[10px] text-blue-500 bg-blue-50 px-1 rounded">{sub.trade}</span>}
                              {sub.status && !['active', 'Approved', 'approved'].includes(sub.status) && (
                                <span className={`text-[10px] px-1 rounded ${
                                  sub.status === 'Out For Signature' ? 'text-amber-600 bg-amber-50' :
                                  sub.status === 'Draft' ? 'text-gray-500 bg-gray-100' : 'text-gray-500 bg-gray-100'
                                }`}>{sub.status}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <span className="text-gray-600 font-mono text-xs shrink-0 ml-3">{fmt(sub.contract_value)}</span>
                      </div>
                    )
                  })}
                  {sortedSubs.length > 8 && (
                    <button
                      onClick={() => setShowAllSubs(!showAllSubs)}
                      className="text-xs text-clipper-gold-dark hover:underline pt-1.5 w-full text-left"
                    >
                      {showAllSubs ? 'Show less' : `+ ${sortedSubs.length - 8} more commitments`}
                    </button>
                  )}
                </div>
              )}
            </div>
          </Section>

          {/* Recent Communications */}
          <Section title="Recent Communications" icon={Mail} defaultOpen={emails.length > 0}>
            <div className="mt-3">
              {emails.length === 0 ? (
                <p className="text-xs text-gray-400">Communication data will populate after next sync.</p>
              ) : (
                <div className="space-y-2">
                  {emails.map((e, i) => (
                    <div key={i} className="text-sm border-l-2 border-gray-200 pl-2.5 py-0.5">
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span className="font-medium text-gray-600">{e.from_name}</span>
                        <span>{e.date}</span>
                      </div>
                      <div className="text-gray-700 truncate">{e.subject}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>

          {/* Budget Snapshot */}
          {budget.length > 0 && (
            <Section title="Budget Summary" icon={TrendingUp} defaultOpen={true}>
              <div className="mt-3 grid grid-cols-3 gap-3 text-center text-sm">
                <div>
                  <div className="text-[10px] text-gray-400 uppercase">Budget</div>
                  <div className="font-bold">{fmt(budget.reduce((s, b) => s + (b.revised_budget || 0), 0))}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase">Actual</div>
                  <div className="font-bold">{fmt(budgetActualCost)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase">Projected</div>
                  <div className="font-bold">{fmt(budget.reduce((s, b) => s + (b.projected_cost || 0), 0))}</div>
                </div>
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
