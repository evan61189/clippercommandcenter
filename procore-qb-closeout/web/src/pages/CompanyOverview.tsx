import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DollarSign, FileText, Wallet, TrendingUp, AlertTriangle,
  ArrowUpRight, ArrowDownRight, Clock, ChevronRight, Plug, Users
} from 'lucide-react'
// import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { supabase } from '../lib/supabase'

// Types
interface StaffMember {
  id: string; first_name: string; last_name: string; role: string;
  max_capacity_slots: number; slots_used: number; utilization_percent: number;
  active_project_count: number; active_projects: string[] | null;
}

interface WipRow {
  project_id: string; code: string; project_name: string; status: string;
  revised_contract_value: number; total_cost: number; total_billed: number;
  gross_margin_percent: number; over_under_billing: number;
}

interface ActionItem {
  id: string; type: string; project_code: string; project_name: string;
  description: string; days_overdue: number; priority: string;
}

const formatCurrency = (val: number | null | undefined) => {
  if (val == null) return '$0'
  const abs = Math.abs(val)
  if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(val / 1_000).toFixed(0)}K`
  return `$${val.toLocaleString()}`
}

const formatPercent = (val: number | null | undefined) => {
  if (val == null) return '0%'
  return `${val.toFixed(1)}%`
}

function StatCard({ label, value, icon: Icon, subtitle, trend, color = 'default' }: {
  label: string; value: string; icon: any; subtitle?: string;
  trend?: { value: string; positive: boolean }; color?: string;
}) {
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</p>
          <p className={`text-2xl font-bold mt-1 ${color === 'gold' ? 'text-clipper-gold-dark' : 'text-clipper-black'}`}>
            {value}
          </p>
          {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
          {trend && (
            <div className={`flex items-center gap-1 mt-1 text-xs font-medium ${trend.positive ? 'text-emerald-600' : 'text-red-600'}`}>
              {trend.positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {trend.value}
            </div>
          )}
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
          color === 'gold' ? 'bg-clipper-gold-light' : 'bg-gray-100'
        }`}>
          <Icon className={`w-5 h-5 ${color === 'gold' ? 'text-clipper-gold-dark' : 'text-gray-600'}`} />
        </div>
      </div>
    </div>
  )
}

function ConnectPlaceholder({ service, description }: { service: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
        <Plug className="w-6 h-6 text-gray-400" />
      </div>
      <p className="text-sm font-medium text-gray-700">Connect {service}</p>
      <p className="text-xs text-gray-500 mt-1 max-w-xs">{description}</p>
      <Link to="/settings" className="btn btn-gold mt-3 text-xs">
        Connect {service}
      </Link>
    </div>
  )
}

function UtilizationBar({ percent }: { percent: number }) {
  const colorClass = percent >= 100 ? 'util-red' : percent >= 75 ? 'util-orange' : percent >= 50 ? 'util-gold' : 'util-green'
  return (
    <div className="w-full bg-gray-200 rounded-full h-2">
      <div className={`${colorClass} h-2 rounded-full transition-all`} style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  )
}

function MarginColor({ value }: { value: number }) {
  const cls = value > 10 ? 'margin-green' : value >= 5 ? 'margin-yellow' : 'margin-red'
  return <span className={`font-semibold ${cls}`}>{value.toFixed(1)}%</span>
}

export default function CompanyOverview() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [wipData, setWipData] = useState<WipRow[]>([])
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [_hasProcore, setHasProcore] = useState(false)
  const [hasQB, setHasQB] = useState(false)

  // Summary metrics
  const totalContractValue = wipData.reduce((s, w) => s + (w.revised_contract_value || 0), 0)
  const totalBilled = wipData.reduce((s, w) => s + (w.total_billed || 0), 0)
  const totalCost = wipData.reduce((s, w) => s + (w.total_cost || 0), 0)
  const companyMargin = totalContractValue > 0 ? ((totalContractValue - totalCost) / totalContractValue) * 100 : 0

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      // Check API connections
      const { data: creds } = await supabase.from('api_credentials').select('provider')
      setHasProcore(creds?.some(c => c.provider === 'procore') || false)
      setHasQB(creds?.some(c => c.provider === 'quickbooks') || false)

      // Load staff utilization
      const { data: staffData } = await supabase.from('staff_utilization').select('*')
      if (staffData) setStaff(staffData)

      // Load WIP data
      const { data: wipRows } = await supabase.from('wip_schedule').select('*')
      if (wipRows) setWipData(wipRows)

      // Load action items (overdue RFIs, pending invoices, etc.)
      const items: ActionItem[] = []

      // Overdue RFIs
      const { data: overdueRfis } = await supabase
        .from('rfis')
        .select('id, number, subject, due_date, projects(code, name)')
        .eq('status', 'open')
        .lt('due_date', new Date().toISOString().split('T')[0])
        .limit(10)

      if (overdueRfis) {
        overdueRfis.forEach((r: any) => {
          const daysOverdue = Math.floor((Date.now() - new Date(r.due_date).getTime()) / 86400000)
          items.push({
            id: r.id, type: 'RFI', project_code: r.projects?.code || '',
            project_name: r.projects?.name || '', description: `RFI #${r.number}: ${r.subject}`,
            days_overdue: daysOverdue, priority: daysOverdue > 7 ? 'high' : 'medium',
          })
        })
      }

      // Overdue submittals
      const { data: overdueSubmittals } = await supabase
        .from('submittals')
        .select('id, number, title, due_date, projects(code, name)')
        .in('status', ['pending', 'open'])
        .lt('due_date', new Date().toISOString().split('T')[0])
        .limit(10)

      if (overdueSubmittals) {
        overdueSubmittals.forEach((s: any) => {
          const daysOverdue = Math.floor((Date.now() - new Date(s.due_date).getTime()) / 86400000)
          items.push({
            id: s.id, type: 'Submittal', project_code: s.projects?.code || '',
            project_name: s.projects?.name || '', description: `Sub #${s.number}: ${s.title}`,
            days_overdue: daysOverdue, priority: daysOverdue > 7 ? 'high' : 'medium',
          })
        })
      }

      // Pending invoices
      const { data: pendingInvoices } = await supabase
        .from('invoices')
        .select('id, number, vendor_name, amount_due, projects(code, name)')
        .eq('status', 'pending')
        .limit(10)

      if (pendingInvoices) {
        pendingInvoices.forEach((inv: any) => {
          items.push({
            id: inv.id, type: 'Invoice', project_code: inv.projects?.code || '',
            project_name: inv.projects?.name || '',
            description: `Invoice #${inv.number} — ${inv.vendor_name} (${formatCurrency(inv.amount_due)})`,
            days_overdue: 0, priority: 'medium',
          })
        })
      }

      // Insurance expirations within 30 days
      const thirtyDaysOut = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
      const { data: expiringIns } = await supabase
        .from('subcontracts')
        .select('id, vendor_name, insurance_expiry, projects(code, name)')
        .not('insurance_expiry', 'is', null)
        .lte('insurance_expiry', thirtyDaysOut)
        .gte('insurance_expiry', new Date().toISOString().split('T')[0])
        .limit(10)

      if (expiringIns) {
        expiringIns.forEach((sc: any) => {
          const daysUntil = Math.floor((new Date(sc.insurance_expiry).getTime() - Date.now()) / 86400000)
          items.push({
            id: sc.id, type: 'Insurance', project_code: sc.projects?.code || '',
            project_name: sc.projects?.name || '',
            description: `${sc.vendor_name} — expires in ${daysUntil} days`,
            days_overdue: -daysUntil, priority: daysUntil < 7 ? 'high' : 'medium',
          })
        })
      }

      // Sort by urgency
      items.sort((a, b) => b.days_overdue - a.days_overdue)
      setActionItems(items)
    } catch (err) {
      console.error('Failed to load dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clipper-gold"></div>
      </div>
    )
  }

  const hasProjectData = wipData.length > 0

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-clipper-black">Company Overview</h1>
        <p className="text-sm text-gray-500 mt-1">Real-time snapshot of project health, financials, and resources</p>
      </div>

      {/* Top Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Active Contract Value"
          value={hasProjectData ? formatCurrency(totalContractValue) : '—'}
          icon={DollarSign}
          subtitle={hasProjectData ? `${wipData.length} active projects` : 'Connect Procore to sync'}
          color="gold"
        />
        <StatCard
          label="Billed to Date"
          value={hasProjectData ? formatCurrency(totalBilled) : '—'}
          icon={FileText}
          subtitle={hasProjectData ? `${totalContractValue > 0 ? ((totalBilled / totalContractValue) * 100).toFixed(0) : 0}% of contract` : undefined}
        />
        <StatCard
          label="Cash Position"
          value={hasQB ? formatCurrency(0) : '—'}
          icon={Wallet}
          subtitle={hasQB ? 'From QuickBooks' : 'Connect QuickBooks'}
        />
        <StatCard
          label="Company Margin"
          value={hasProjectData ? formatPercent(companyMargin) : '—'}
          icon={TrendingUp}
          subtitle={hasProjectData ? formatCurrency(totalContractValue - totalCost) + ' projected profit' : undefined}
          color={companyMargin > 10 ? 'default' : 'default'}
        />
        <StatCard
          label="Action Items"
          value={actionItems.length.toString()}
          icon={AlertTriangle}
          subtitle={actionItems.filter(a => a.priority === 'high').length > 0
            ? `${actionItems.filter(a => a.priority === 'high').length} urgent`
            : 'All on track'}
        />
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* WIP Summary — takes 2 columns */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-clipper-black">WIP Summary</h2>
            <Link to="/financials" className="text-xs text-clipper-gold-dark hover:underline flex items-center gap-1">
              Full WIP Schedule <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          {!hasProjectData ? (
            <ConnectPlaceholder
              service="Procore"
              description="Sync projects from Procore to see your WIP summary with real contract values, billings, and margins."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="table-header py-2 pr-4">Project</th>
                    <th className="table-header py-2 px-3 text-right">Revised Value</th>
                    <th className="table-header py-2 px-3 text-right">Billed</th>
                    <th className="table-header py-2 px-3 text-right">Over/Under</th>
                    <th className="table-header py-2 px-3 text-right">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {wipData.map((row) => {
                    const overUnder = row.over_under_billing || 0
                    const margin = row.gross_margin_percent || 0
                    return (
                      <tr key={row.project_id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2.5 pr-4">
                          <Link to={`/projects/${row.project_id}`} className="font-medium text-clipper-black hover:text-clipper-gold-dark">
                            {row.code || row.project_name}
                          </Link>
                          {row.code && <p className="text-xs text-gray-500">{row.project_name}</p>}
                        </td>
                        <td className="py-2.5 px-3 text-right font-medium">{formatCurrency(row.revised_contract_value)}</td>
                        <td className="py-2.5 px-3 text-right">{formatCurrency(row.total_billed)}</td>
                        <td className={`py-2.5 px-3 text-right font-medium ${overUnder > 0 ? 'text-amber-600' : overUnder < 0 ? 'text-red-600' : ''}`}>
                          {formatCurrency(overUnder)}
                        </td>
                        <td className="py-2.5 px-3 text-right"><MarginColor value={margin} /></td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 font-semibold">
                    <td className="py-2.5 pr-4">Total ({wipData.length} projects)</td>
                    <td className="py-2.5 px-3 text-right">{formatCurrency(totalContractValue)}</td>
                    <td className="py-2.5 px-3 text-right">{formatCurrency(totalBilled)}</td>
                    <td className="py-2.5 px-3 text-right">—</td>
                    <td className="py-2.5 px-3 text-right"><MarginColor value={companyMargin} /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Staff Utilization — right column */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-clipper-black">Staff Utilization</h2>
            <Link to="/resources" className="text-xs text-clipper-gold-dark hover:underline flex items-center gap-1">
              Manage <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          {staff.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Users className="w-8 h-8 text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">Staff roster loaded. Assign team to projects to see utilization.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {staff.map((s) => (
                <div key={s.id}>
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <span className="text-sm font-medium">{s.first_name} {s.last_name}</span>
                      <span className="text-xs text-gray-500 ml-2">
                        {s.role === 'project_manager' ? 'PM' : 'Super'}
                      </span>
                    </div>
                    <span className={`text-xs font-semibold ${
                      s.utilization_percent >= 100 ? 'text-red-600' :
                      s.utilization_percent >= 75 ? 'text-orange-600' :
                      s.utilization_percent >= 50 ? 'text-clipper-gold-dark' : 'text-emerald-600'
                    }`}>
                      {s.slots_used}/{s.max_capacity_slots} slots
                    </span>
                  </div>
                  <UtilizationBar percent={s.utilization_percent} />
                  {s.active_projects && s.active_projects.length > 0 && (
                    <p className="text-xs text-gray-400 mt-0.5">{s.active_projects.join(', ')}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Hiring status */}
          {staff.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">PM Capacity</span>
                <span className="font-medium">
                  {staff.filter(s => s.role === 'project_manager').reduce((sum, s) => sum + s.slots_used, 0)}/
                  {staff.filter(s => s.role === 'project_manager').reduce((sum, s) => sum + s.max_capacity_slots, 0)} slots
                </span>
              </div>
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-gray-500">Super Capacity</span>
                <span className="font-medium">
                  {staff.filter(s => s.role === 'superintendent').reduce((sum, s) => sum + s.slots_used, 0)}/
                  {staff.filter(s => s.role === 'superintendent').reduce((sum, s) => sum + s.max_capacity_slots, 0)} slots
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action Items */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-clipper-black">Action Items</h2>
          <span className="badge badge-gray">{actionItems.length} items</span>
        </div>

        {actionItems.length === 0 && !hasProjectData ? (
          <ConnectPlaceholder
            service="Procore"
            description="Connect Procore to track RFIs, submittals, change orders, and other action items across all projects."
          />
        ) : actionItems.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-gray-500">No overdue items — all clear.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="table-header py-2 pr-4">Type</th>
                  <th className="table-header py-2 px-3">Project</th>
                  <th className="table-header py-2 px-3">Description</th>
                  <th className="table-header py-2 px-3 text-right">Days Overdue</th>
                  <th className="table-header py-2 px-3">Priority</th>
                </tr>
              </thead>
              <tbody>
                {actionItems.slice(0, 15).map((item) => (
                  <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 pr-4">
                      <span className={`badge ${
                        item.type === 'RFI' ? 'badge-blue' :
                        item.type === 'Insurance' ? 'badge-red' :
                        item.type === 'Invoice' ? 'badge-yellow' : 'badge-gray'
                      }`}>
                        {item.type}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-medium">{item.project_code || item.project_name}</td>
                    <td className="py-2 px-3 text-gray-600 max-w-xs truncate">{item.description}</td>
                    <td className="py-2 px-3 text-right">
                      {item.days_overdue > 0 ? (
                        <span className="text-red-600 font-medium flex items-center justify-end gap-1">
                          <Clock className="w-3 h-3" /> {item.days_overdue}d
                        </span>
                      ) : item.type === 'Insurance' ? (
                        <span className="text-amber-600">{Math.abs(item.days_overdue)}d left</span>
                      ) : '—'}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`badge ${item.priority === 'high' ? 'badge-red' : 'badge-yellow'}`}>
                        {item.priority}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
