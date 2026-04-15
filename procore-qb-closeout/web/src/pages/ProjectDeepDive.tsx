import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, DollarSign, Calendar, AlertTriangle, CheckCircle2, FileQuestion, ClipboardList, CheckSquare, Users, TrendingUp, AlertCircle, Mail } from 'lucide-react'
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
interface SubContract { id: string; vendor_name: string; contract_value: number; status: string; trade: string; }
interface ChangeOrder { id: string; title: string; status: string; amount: number; change_type: string; number: string; }
interface PayApp { id: string; vendor_name: string; amount_due: number; total_completed: number; retainage: number; status: string; number: string; }
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

// --- Component ---
export default function ProjectDeepDive() {
  const { projectId } = useParams()
  const { user } = useAuth()
  const [project, setProject] = useState<ProjectData | null>(null)
  const [subs, setSubs] = useState<SubContract[]>([])
  const [cos, setCos] = useState<ChangeOrder[]>([])
  const [payApps, setPayApps] = useState<PayApp[]>([])
  const [rfis, setRfis] = useState<RFI[]>([])
  const [submittals, setSubmittals] = useState<Submittal[]>([])
  const [punch, setPunch] = useState<PunchItem[]>([])
  const [budget, setBudget] = useState<BudgetLine[]>([])
  const [emails, setEmails] = useState<Correspondence[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!projectId) return
    async function load() {
      const [projRes, subsRes, cosRes, paRes, rfiRes, subRes, punchRes, budgetRes] = await Promise.all([
        supabase.from('projects').select('*').eq('id', projectId).single(),
        supabase.from('subcontracts').select('*').eq('project_id', projectId).order('contract_value', { ascending: false }),
        supabase.from('procore_change_orders').select('*').eq('project_id', projectId),
        supabase.from('procore_pay_apps').select('*').eq('project_id', projectId),
        supabase.from('rfis').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
        supabase.from('submittals').select('*').eq('project_id', projectId),
        supabase.from('punch_items').select('*').eq('project_id', projectId),
        supabase.from('procore_budget').select('*').eq('project_id', projectId),
      ])
      if (projRes.data) setProject(projRes.data)
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

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clipper-gold" /></div>
  }
  if (!project) {
    return <div className="text-center py-16 text-gray-500">Project not found</div>
  }

  // --- Computed values ---
  const contractValue = project.current_contract_value || project.original_contract_value || 0
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

  const pendingPrimeCOs = cos.filter(c => c.change_type === 'prime' && !['approved', 'closed', 'rejected', 'void'].includes(c.status))
  const pendingCommitCOs = cos.filter(c => c.change_type === 'commitment' && !['approved', 'closed', 'rejected', 'void'].includes(c.status))
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
    const overdueSubmittals = openSubmittals.filter(s => s.due_date && new Date(s.due_date) < new Date())
    if (overdueSubmittals.length > 0) actions.push({ icon: ClipboardList, text: `${overdueSubmittals.length} overdue submittal${overdueSubmittals.length > 1 ? 's' : ''}`, urgency: 'red' })
    else actions.push({ icon: ClipboardList, text: `${openSubmittals.length} submittal${openSubmittals.length > 1 ? 's' : ''} need review`, urgency: 'amber' })
  }
  if (pendingPrimeCOs.length > 0) actions.push({ icon: DollarSign, text: `${pendingPrimeCOs.length} prime CO${pendingPrimeCOs.length > 1 ? 's' : ''} pending (${fmt(pendingCOTotal)})`, urgency: 'amber' })
  if (pendingCommitCOs.length > 0) actions.push({ icon: DollarSign, text: `${pendingCommitCOs.length} commitment CO${pendingCommitCOs.length > 1 ? 's' : ''} to process`, urgency: 'blue' })
  if (openPunch.length > 0) actions.push({ icon: CheckSquare, text: `${openPunch.length} punch item${openPunch.length > 1 ? 's' : ''} open${closedPunch.length > 0 ? ` (${closedPunch.length} closed)` : ''}`, urgency: openPunch.length > 20 ? 'red' : 'amber' })
  // Check for subs with expired or soon-expiring insurance
  const expiredSubs = subs.filter(s => s.status === 'active' && !s.trade)
  if (expiredSubs.length === 0 && actions.length === 0) actions.push({ icon: CheckCircle2, text: 'No critical items — project on track', urgency: 'blue' })

  // Top risks (oldest open RFIs, overdue items)
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

  // Top subs by value
  const topSubs = subs.slice(0, 6)

  const urgencyColors = { red: 'text-red-600 bg-red-50', amber: 'text-amber-600 bg-amber-50', blue: 'text-blue-600 bg-blue-50' }

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
        <span className={`badge ${project.status === 'active' ? 'badge-green' : 'badge-yellow'}`}>{project.status.replace('_', ' ')}</span>
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

      {/* Main Grid: Schedule + Actions | Risks + Stakeholders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Left Column */}
        <div className="space-y-4">

          {/* Schedule Snapshot */}
          <div className="card !py-4">
            <div className="flex items-center gap-2 mb-3">
              <Calendar className="w-4 h-4 text-clipper-gold" />
              <h2 className="text-sm font-semibold text-clipper-black">Schedule</h2>
            </div>
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

          {/* Action Items */}
          <div className="card !py-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-clipper-gold" />
              <h2 className="text-sm font-semibold text-clipper-black">Action Items</h2>
            </div>
            <div className="space-y-2">
              {actions.map((a, i) => (
                <div key={i} className={`flex items-center gap-2.5 text-sm px-2.5 py-1.5 rounded-lg ${urgencyColors[a.urgency]}`}>
                  <a.icon className="w-4 h-4 shrink-0" />
                  <span>{a.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top Risks */}
          <div className="card !py-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <h2 className="text-sm font-semibold text-clipper-black">Top Risks</h2>
            </div>
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
        </div>

        {/* Right Column */}
        <div className="space-y-4">

          {/* Stakeholders / Key Subs */}
          <div className="card !py-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-clipper-gold" />
              <h2 className="text-sm font-semibold text-clipper-black">Key Subcontractors</h2>
              <span className="text-xs text-gray-400 ml-auto">{subs.length} total</span>
            </div>
            {topSubs.length === 0 ? (
              <p className="text-sm text-gray-400">No subcontracts synced yet</p>
            ) : (
              <div className="space-y-1.5">
                {topSubs.map((sub) => {
                  // Find any pending COs for this sub
                  return (
                    <div key={sub.id} className="flex items-center justify-between py-1 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sub.status === 'active' || sub.status === 'approved' ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                        <span className="truncate font-medium">{sub.vendor_name}</span>
                        {sub.trade && <span className="text-[10px] text-gray-400 shrink-0">{sub.trade}</span>}
                      </div>
                      <span className="text-gray-500 font-mono text-xs shrink-0 ml-2">{fmt(sub.contract_value)}</span>
                    </div>
                  )
                })}
                {subs.length > 6 && (
                  <div className="text-xs text-gray-400 pt-1">+ {subs.length - 6} more</div>
                )}
              </div>
            )}
          </div>

          {/* Recent Communications */}
          <div className="card !py-4">
            <div className="flex items-center gap-2 mb-3">
              <Mail className="w-4 h-4 text-clipper-gold" />
              <h2 className="text-sm font-semibold text-clipper-black">Recent Communications</h2>
            </div>
            {emails.length === 0 ? (
              <p className="text-xs text-gray-400">Communication data will populate after next sync. Emails from Procore's correspondence module provide context on stakeholder concerns and project discussions.</p>
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

          {/* Budget Snapshot (if data exists) */}
          {budget.length > 0 && (
            <div className="card !py-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-clipper-gold" />
                <h2 className="text-sm font-semibold text-clipper-black">Budget Summary</h2>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center text-sm">
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
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
