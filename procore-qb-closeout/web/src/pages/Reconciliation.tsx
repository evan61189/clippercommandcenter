import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { GitCompare, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'

interface Snapshot {
  id: string; project_id: string; snapshot_date: string; procore_contract_value: number;
  qb_contract_value: number; procore_billed: number; qb_billed: number;
  procore_cost: number; qb_cost: number; variance_contract: number;
  variance_billed: number; variance_cost: number; match_status: string;
}

interface UnmatchedProject {
  id: string; source: string; source_id: string; project_name: string;
  contract_value: number; reason: string;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '$0'
  return n < 0
    ? `-$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function statusIcon(status: string) {
  if (status === 'matched') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />
  if (status === 'variance') return <AlertTriangle className="w-4 h-4 text-amber-500" />
  return <XCircle className="w-4 h-4 text-red-500" />
}

function statusBadge(status: string) {
  const cls = status === 'matched' ? 'badge-green' : status === 'variance' ? 'badge-yellow' : 'badge-red'
  return <span className={`badge ${cls}`}>{status}</span>
}

export default function Reconciliation() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [unmatched, setUnmatched] = useState<UnmatchedProject[]>([])
  const [loading, setLoading] = useState(true)
  const [hasData, setHasData] = useState(false)

  useEffect(() => {
    async function load() {
      const [snapRes, unmatchedRes] = await Promise.all([
        supabase.from('reconciliation_snapshots').select('*').order('snapshot_date', { ascending: false }).limit(50),
        supabase.from('unmatched_projects').select('*').order('contract_value', { ascending: false }),
      ])
      if (snapRes.data) setSnapshots(snapRes.data)
      if (unmatchedRes.data) setUnmatched(unmatchedRes.data)
      setHasData((snapRes.data?.length || 0) > 0 || (unmatchedRes.data?.length || 0) > 0)
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
          <h1 className="text-2xl font-bold text-clipper-black">Reconciliation</h1>
          <p className="text-sm text-gray-500 mt-1">Procore vs QuickBooks — compare every number and flag mismatches</p>
        </div>
        <div className="card flex flex-col items-center justify-center py-16">
          <GitCompare className="w-12 h-12 text-gray-300 mb-3" />
          <p className="text-lg font-medium text-gray-700">Connect Both Systems</p>
          <p className="text-sm text-gray-500 mt-1 max-w-md text-center">
            Reconciliation compares financial data between Procore (project management) and QuickBooks (accounting).
            Both must be connected to run comparisons.
          </p>
          <div className="flex gap-3 mt-4">
            <Link to="/settings" className="btn btn-gold">Connect Procore</Link>
            <Link to="/settings" className="btn btn-secondary">Connect QuickBooks</Link>
          </div>
        </div>
      </div>
    )
  }

  const matched = snapshots.filter(s => s.match_status === 'matched').length
  const variances = snapshots.filter(s => s.match_status === 'variance').length
  const totalVarianceContract = snapshots.reduce((s, r) => s + Math.abs(r.variance_contract || 0), 0)
  const totalVarianceBilled = snapshots.reduce((s, r) => s + Math.abs(r.variance_billed || 0), 0)

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-clipper-black">Reconciliation</h1>
          <p className="text-sm text-gray-500 mt-1">Procore vs QuickBooks — compare every number and flag mismatches</p>
        </div>
        <button className="btn btn-gold">Run Reconciliation</button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Projects</div>
          <div className="text-2xl font-bold mt-1">{snapshots.length}</div>
        </div>
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Matched
          </div>
          <div className="text-2xl font-bold mt-1 text-emerald-600">{matched}</div>
        </div>
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-amber-500" /> Variances
          </div>
          <div className="text-2xl font-bold mt-1 text-amber-600">{variances}</div>
        </div>
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Contract Variance</div>
          <div className="text-2xl font-bold mt-1">{fmt(totalVarianceContract)}</div>
        </div>
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Billing Variance</div>
          <div className="text-2xl font-bold mt-1">{fmt(totalVarianceBilled)}</div>
        </div>
      </div>

      {/* Snapshot Table */}
      <div className="card">
        <h2 className="text-lg font-semibold text-clipper-black mb-4">Comparison Detail</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header py-2 pr-3">Status</th>
                <th className="table-header py-2 px-3 text-right">Procore Contract</th>
                <th className="table-header py-2 px-3 text-right">QB Contract</th>
                <th className="table-header py-2 px-3 text-right">Variance</th>
                <th className="table-header py-2 px-3 text-right">Procore Billed</th>
                <th className="table-header py-2 px-3 text-right">QB Billed</th>
                <th className="table-header py-2 px-3 text-right">Variance</th>
                <th className="table-header py-2 px-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 pr-3 flex items-center gap-2">
                    {statusIcon(s.match_status)} {statusBadge(s.match_status)}
                  </td>
                  <td className="py-2 px-3 text-right">{fmt(s.procore_contract_value)}</td>
                  <td className="py-2 px-3 text-right">{fmt(s.qb_contract_value)}</td>
                  <td className={`py-2 px-3 text-right font-medium ${(s.variance_contract || 0) !== 0 ? 'text-red-600' : 'text-gray-400'}`}>
                    {fmt(s.variance_contract)}
                  </td>
                  <td className="py-2 px-3 text-right">{fmt(s.procore_billed)}</td>
                  <td className="py-2 px-3 text-right">{fmt(s.qb_billed)}</td>
                  <td className={`py-2 px-3 text-right font-medium ${(s.variance_billed || 0) !== 0 ? 'text-red-600' : 'text-gray-400'}`}>
                    {fmt(s.variance_billed)}
                  </td>
                  <td className="py-2 px-3 text-gray-500 text-xs">{new Date(s.snapshot_date).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Unmatched Projects */}
      {unmatched.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <XCircle className="w-5 h-5 text-red-500" />
            <h2 className="text-lg font-semibold text-clipper-black">Unmatched Projects</h2>
            <span className="badge badge-red ml-2">{unmatched.length}</span>
          </div>
          <p className="text-sm text-gray-500 mb-4">Projects found in one system but not the other — these need manual review.</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header py-2 pr-3">Project</th>
                <th className="table-header py-2 px-3">Source</th>
                <th className="table-header py-2 px-3 text-right">Contract Value</th>
                <th className="table-header py-2 px-3">Reason</th>
              </tr>
            </thead>
            <tbody>
              {unmatched.map((u) => (
                <tr key={u.id} className="border-b border-gray-100">
                  <td className="py-2 pr-3 font-medium">{u.project_name}</td>
                  <td className="py-2 px-3">
                    <span className={`badge ${u.source === 'procore' ? 'badge-blue' : 'badge-green'}`}>
                      {u.source === 'procore' ? 'Procore' : 'QuickBooks'}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right">{fmt(u.contract_value)}</td>
                  <td className="py-2 px-3 text-gray-500 text-xs">{u.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
