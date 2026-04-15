import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Shield, AlertTriangle, Clock, FileCheck, HardHat } from 'lucide-react'

interface OverdueRfi {
  id: string; project_id: string; number: number; subject: string;
  status: string; due_date: string; days_overdue: number;
}

interface OverdueSubmittal {
  id: string; project_id: string; number: number; title: string;
  status: string; due_date: string; days_overdue: number;
}

interface ExpiringInsurance {
  id: string; vendor_name: string; policy_type: string;
  expiration_date: string; days_until_expiry: number;
  project_name?: string;
}

interface SafetyObservation {
  id: string; project_id: string; title: string; type: string;
  priority: string; status: string; observed_at: string;
}

interface PunchItem {
  id: string; project_id: string; title: string; status: string;
  priority: string; due_date: string;
}

function daysLabel(d: number): string {
  if (d <= 0) return 'Today'
  if (d === 1) return '1 day'
  return `${d} days`
}

export default function ComplianceRisk() {
  const [overdueRfis, setOverdueRfis] = useState<OverdueRfi[]>([])
  const [overdueSubmittals, setOverdueSubmittals] = useState<OverdueSubmittal[]>([])
  const [expiringIns, setExpiringIns] = useState<ExpiringInsurance[]>([])
  const [safetyObs, setSafetyObs] = useState<SafetyObservation[]>([])
  const [openPunch, setOpenPunch] = useState<PunchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [hasData, setHasData] = useState(false)

  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().split('T')[0]
      const thirtyDays = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]

      const [rfiRes, subRes, subcontractRes, obsRes, punchRes] = await Promise.all([
        supabase.from('rfis').select('*').lt('due_date', today).neq('status', 'closed').order('due_date').limit(20),
        supabase.from('submittals').select('*').lt('due_date', today).neq('status', 'closed').order('due_date').limit(20),
        supabase.from('subcontracts').select('id, vendor_name, insurance_expiry, project_id')
          .lt('insurance_expiry', thirtyDays).not('insurance_expiry', 'is', null).order('insurance_expiry').limit(20),
        supabase.from('observations').select('*').neq('status', 'closed').order('observed_at', { ascending: false }).limit(15),
        supabase.from('punch_items').select('*').neq('status', 'closed').order('due_date').limit(20),
      ])

      const rfis: OverdueRfi[] = (rfiRes.data || []).map(r => ({
        ...r,
        days_overdue: Math.floor((Date.now() - new Date(r.due_date).getTime()) / 86400000),
      }))
      const subs: OverdueSubmittal[] = (subRes.data || []).map(s => ({
        ...s,
        days_overdue: Math.floor((Date.now() - new Date(s.due_date).getTime()) / 86400000),
      }))
      const ins: ExpiringInsurance[] = (subcontractRes.data || []).map(s => ({
        id: s.id,
        vendor_name: s.vendor_name,
        policy_type: 'General Liability',
        expiration_date: s.insurance_expiry,
        days_until_expiry: Math.floor((new Date(s.insurance_expiry).getTime() - Date.now()) / 86400000),
      }))

      setOverdueRfis(rfis)
      setOverdueSubmittals(subs)
      setExpiringIns(ins)
      if (obsRes.data) setSafetyObs(obsRes.data)
      if (punchRes.data) setOpenPunch(punchRes.data)

      setHasData(
        rfis.length > 0 || subs.length > 0 || ins.length > 0 ||
        (obsRes.data?.length || 0) > 0 || (punchRes.data?.length || 0) > 0
      )
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clipper-gold" /></div>
  }

  if (!hasData) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <div>
          <h1 className="text-2xl font-bold text-clipper-black">Compliance & Risk</h1>
          <p className="text-sm text-gray-500 mt-1">Insurance tracking, safety trends, overdue items, and workflow bottlenecks</p>
        </div>
        <div className="card flex flex-col items-center justify-center py-16">
          <Shield className="w-12 h-12 text-gray-300 mb-3" />
          <p className="text-lg font-medium text-gray-700">No Data Yet</p>
          <p className="text-sm text-gray-500 mt-1 max-w-md text-center">
            Connect Procore to sync subcontract insurance dates, safety observations, overdue RFIs/submittals,
            and pending signatures across all projects.
          </p>
          <Link to="/settings" className="btn btn-gold mt-4">Connect Procore</Link>
        </div>
      </div>
    )
  }

  const totalIssues = overdueRfis.length + overdueSubmittals.length + expiringIns.length + safetyObs.length + openPunch.length

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-2xl font-bold text-clipper-black">Compliance & Risk</h1>
        <p className="text-sm text-gray-500 mt-1">Insurance tracking, safety trends, overdue items, and workflow bottlenecks</p>
      </div>

      {/* Risk Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Issues</div>
          <div className={`text-2xl font-bold mt-1 ${totalIssues > 10 ? 'text-red-600' : totalIssues > 5 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {totalIssues}
          </div>
        </div>
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Overdue RFIs</div>
          <div className={`text-2xl font-bold mt-1 ${overdueRfis.length > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {overdueRfis.length}
          </div>
        </div>
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Overdue Submittals</div>
          <div className={`text-2xl font-bold mt-1 ${overdueSubmittals.length > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {overdueSubmittals.length}
          </div>
        </div>
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Expiring Insurance</div>
          <div className={`text-2xl font-bold mt-1 ${expiringIns.length > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {expiringIns.length}
          </div>
        </div>
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Open Punch Items</div>
          <div className="text-2xl font-bold mt-1">{openPunch.length}</div>
        </div>
      </div>

      {/* Overdue RFIs */}
      {overdueRfis.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-red-500" />
            <h2 className="text-lg font-semibold text-clipper-black">Overdue RFIs</h2>
            <span className="badge badge-red ml-2">{overdueRfis.length}</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header py-2 pr-3">#</th>
                <th className="table-header py-2 px-3">Subject</th>
                <th className="table-header py-2 px-3">Status</th>
                <th className="table-header py-2 px-3">Due</th>
                <th className="table-header py-2 px-3 text-right">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {overdueRfis.map((r) => (
                <tr key={r.id} className="border-b border-gray-100">
                  <td className="py-2 pr-3 font-medium">RFI-{r.number}</td>
                  <td className="py-2 px-3 truncate max-w-[280px]">{r.subject}</td>
                  <td className="py-2 px-3"><span className="badge badge-yellow">{r.status}</span></td>
                  <td className="py-2 px-3 text-gray-500 text-xs">{new Date(r.due_date).toLocaleDateString()}</td>
                  <td className="py-2 px-3 text-right text-red-600 font-medium">{daysLabel(r.days_overdue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Overdue Submittals */}
      {overdueSubmittals.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <FileCheck className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-clipper-black">Overdue Submittals</h2>
            <span className="badge badge-yellow ml-2">{overdueSubmittals.length}</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header py-2 pr-3">#</th>
                <th className="table-header py-2 px-3">Title</th>
                <th className="table-header py-2 px-3">Status</th>
                <th className="table-header py-2 px-3">Due</th>
                <th className="table-header py-2 px-3 text-right">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {overdueSubmittals.map((s) => (
                <tr key={s.id} className="border-b border-gray-100">
                  <td className="py-2 pr-3 font-medium">SUB-{s.number}</td>
                  <td className="py-2 px-3 truncate max-w-[280px]">{s.title}</td>
                  <td className="py-2 px-3"><span className="badge badge-yellow">{s.status}</span></td>
                  <td className="py-2 px-3 text-gray-500 text-xs">{new Date(s.due_date).toLocaleDateString()}</td>
                  <td className="py-2 px-3 text-right text-red-600 font-medium">{daysLabel(s.days_overdue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Expiring Insurance */}
      {expiringIns.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-clipper-black">Expiring Insurance (next 30 days)</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header py-2 pr-3">Vendor</th>
                <th className="table-header py-2 px-3">Policy</th>
                <th className="table-header py-2 px-3">Expires</th>
                <th className="table-header py-2 px-3 text-right">Days Left</th>
              </tr>
            </thead>
            <tbody>
              {expiringIns.map((ins) => (
                <tr key={ins.id} className="border-b border-gray-100">
                  <td className="py-2 pr-3 font-medium">{ins.vendor_name}</td>
                  <td className="py-2 px-3 text-gray-500">{ins.policy_type}</td>
                  <td className="py-2 px-3 text-gray-500 text-xs">{new Date(ins.expiration_date).toLocaleDateString()}</td>
                  <td className={`py-2 px-3 text-right font-medium ${ins.days_until_expiry <= 7 ? 'text-red-600' : ins.days_until_expiry <= 14 ? 'text-amber-600' : 'text-gray-600'}`}>
                    {ins.days_until_expiry <= 0 ? 'EXPIRED' : `${ins.days_until_expiry}d`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Safety Observations */}
      {safetyObs.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <HardHat className="w-5 h-5 text-clipper-gold" />
            <h2 className="text-lg font-semibold text-clipper-black">Open Safety Observations</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header py-2 pr-3">Title</th>
                <th className="table-header py-2 px-3">Type</th>
                <th className="table-header py-2 px-3">Priority</th>
                <th className="table-header py-2 px-3">Status</th>
                <th className="table-header py-2 px-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {safetyObs.map((o) => (
                <tr key={o.id} className="border-b border-gray-100">
                  <td className="py-2 pr-3 font-medium truncate max-w-[250px]">{o.title}</td>
                  <td className="py-2 px-3"><span className="badge badge-gray">{o.type}</span></td>
                  <td className="py-2 px-3">
                    <span className={`badge ${o.priority === 'high' ? 'badge-red' : o.priority === 'medium' ? 'badge-yellow' : 'badge-gray'}`}>
                      {o.priority}
                    </span>
                  </td>
                  <td className="py-2 px-3"><span className="badge badge-blue">{o.status}</span></td>
                  <td className="py-2 px-3 text-gray-500 text-xs">{new Date(o.observed_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
