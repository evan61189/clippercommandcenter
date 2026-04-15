import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle, Plug } from 'lucide-react'

interface WipRow {
  project_id: string
  project_name: string
  revised_contract_value: number
  total_billed: number
  total_cost: number
  over_under_billing: number
  gross_margin_percent: number
}

interface ArAgingRow {
  id: string; customer_name: string; invoice_number: string; amount: number;
  due_date: string; aging_bucket: string; days_past_due: number;
}

interface ApAgingRow {
  id: string; vendor_name: string; bill_number: string; amount: number;
  due_date: string; aging_bucket: string; days_past_due: number;
}

interface BankBalance {
  id: string; account_name: string; current_balance: number; as_of_date: string;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '$0'
  return n < 0
    ? `-$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function marginColor(pct: number): string {
  if (pct >= 20) return 'text-emerald-600'
  if (pct >= 10) return 'text-amber-600'
  return 'text-red-600'
}

export default function FinancialHealth() {
  const [wip, setWip] = useState<WipRow[]>([])
  const [ar, setAr] = useState<ArAgingRow[]>([])
  const [ap, setAp] = useState<ApAgingRow[]>([])
  const [bank, setBank] = useState<BankBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [hasData, setHasData] = useState(false)

  useEffect(() => {
    async function load() {
      const [wipRes, arRes, apRes, bankRes] = await Promise.all([
        supabase.from('wip_schedule').select('*'),
        supabase.from('qb_ar_aging').select('*').order('days_past_due', { ascending: false }).limit(20),
        supabase.from('qb_ap_aging').select('*').order('days_past_due', { ascending: false }).limit(20),
        supabase.from('qb_bank_balances').select('*').order('current_balance', { ascending: false }),
      ])
      if (wipRes.data) setWip(wipRes.data)
      if (arRes.data) setAr(arRes.data)
      if (apRes.data) setAp(apRes.data)
      if (bankRes.data) setBank(bankRes.data)
      setHasData(
        (wipRes.data?.length || 0) > 0 ||
        (arRes.data?.length || 0) > 0 ||
        (apRes.data?.length || 0) > 0 ||
        (bankRes.data?.length || 0) > 0
      )
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clipper-gold" /></div>
  }

  // Summary stats from WIP
  const totalContract = wip.reduce((s, r) => s + (r.revised_contract_value || 0), 0)
  const totalBilled = wip.reduce((s, r) => s + (r.total_billed || 0), 0)
  const totalCost = wip.reduce((s, r) => s + (r.total_cost || 0), 0)
  const totalOverUnder = wip.reduce((s, r) => s + (r.over_under_billing || 0), 0)
  const overallMargin = totalContract > 0 ? ((totalContract - totalCost) / totalContract) * 100 : 0
  const cashOnHand = bank.reduce((s, b) => s + (b.current_balance || 0), 0)
  const arTotal = ar.reduce((s, r) => s + (r.amount || 0), 0)
  const apTotal = ap.reduce((s, r) => s + (r.amount || 0), 0)

  if (!hasData) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <div>
          <h1 className="text-2xl font-bold text-clipper-black">Financial Health</h1>
          <p className="text-sm text-gray-500 mt-1">WIP schedule, AR/AP aging, retainage, and cash flow projections</p>
        </div>
        <div className="card flex flex-col items-center justify-center py-16">
          <Plug className="w-12 h-12 text-gray-300 mb-3" />
          <p className="text-lg font-medium text-gray-700">Connect Data Sources</p>
          <p className="text-sm text-gray-500 mt-1 max-w-md text-center">
            The WIP schedule pulls contract/billing data from Procore and cost data from QuickBooks.
            Connect both to see the full financial picture.
          </p>
          <div className="flex gap-3 mt-4">
            <Link to="/settings" className="btn btn-gold">Connect Procore</Link>
            <Link to="/settings" className="btn btn-secondary">Connect QuickBooks</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-2xl font-bold text-clipper-black">Financial Health</h1>
        <p className="text-sm text-gray-500 mt-1">WIP schedule, AR/AP aging, retainage, and cash flow projections</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Contract</div>
          <div className="text-xl font-bold mt-1">{fmt(totalContract)}</div>
        </div>
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Billed</div>
          <div className="text-xl font-bold mt-1">{fmt(totalBilled)}</div>
        </div>
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Cost</div>
          <div className="text-xl font-bold mt-1">{fmt(totalCost)}</div>
        </div>
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Over/Under</div>
          <div className={`text-xl font-bold mt-1 ${totalOverUnder >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {fmt(totalOverUnder)}
          </div>
        </div>
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Gross Margin</div>
          <div className={`text-xl font-bold mt-1 ${marginColor(overallMargin)}`}>
            {overallMargin.toFixed(1)}%
          </div>
        </div>
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Cash on Hand</div>
          <div className="text-xl font-bold mt-1">{fmt(cashOnHand)}</div>
        </div>
      </div>

      {/* WIP Schedule */}
      {wip.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="w-5 h-5 text-clipper-gold" />
            <h2 className="text-lg font-semibold text-clipper-black">WIP Schedule</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="table-header py-2 pr-4">Project</th>
                  <th className="table-header py-2 px-3 text-right">Contract Value</th>
                  <th className="table-header py-2 px-3 text-right">Billed</th>
                  <th className="table-header py-2 px-3 text-right">Cost</th>
                  <th className="table-header py-2 px-3 text-right">Over/Under</th>
                  <th className="table-header py-2 px-3 text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {wip.map((r) => (
                  <tr key={r.project_id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 pr-4 font-medium">{r.project_name}</td>
                    <td className="py-3 px-3 text-right">{fmt(r.revised_contract_value)}</td>
                    <td className="py-3 px-3 text-right">{fmt(r.total_billed)}</td>
                    <td className="py-3 px-3 text-right">{fmt(r.total_cost)}</td>
                    <td className={`py-3 px-3 text-right font-medium ${(r.over_under_billing || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {fmt(r.over_under_billing)}
                    </td>
                    <td className={`py-3 px-3 text-right font-medium ${marginColor(r.gross_margin_percent || 0)}`}>
                      {(r.gross_margin_percent || 0).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AR / AP Side by Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* AR Aging */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-500" />
              <h2 className="text-lg font-semibold text-clipper-black">Accounts Receivable</h2>
            </div>
            <span className="text-sm font-medium text-gray-500">Total: {fmt(arTotal)}</span>
          </div>
          {ar.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No AR data — connect QuickBooks</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="table-header py-2 pr-3">Customer</th>
                  <th className="table-header py-2 px-3 text-right">Amount</th>
                  <th className="table-header py-2 px-3">Aging</th>
                </tr>
              </thead>
              <tbody>
                {ar.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100">
                    <td className="py-2 pr-3 font-medium truncate max-w-[180px]">{r.customer_name}</td>
                    <td className="py-2 px-3 text-right">{fmt(r.amount)}</td>
                    <td className="py-2 px-3">
                      <span className={`badge ${r.days_past_due > 60 ? 'badge-red' : r.days_past_due > 30 ? 'badge-yellow' : 'badge-green'}`}>
                        {r.aging_bucket || `${r.days_past_due}d`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* AP Aging */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-red-500" />
              <h2 className="text-lg font-semibold text-clipper-black">Accounts Payable</h2>
            </div>
            <span className="text-sm font-medium text-gray-500">Total: {fmt(apTotal)}</span>
          </div>
          {ap.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No AP data — connect QuickBooks</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="table-header py-2 pr-3">Vendor</th>
                  <th className="table-header py-2 px-3 text-right">Amount</th>
                  <th className="table-header py-2 px-3">Aging</th>
                </tr>
              </thead>
              <tbody>
                {ap.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100">
                    <td className="py-2 pr-3 font-medium truncate max-w-[180px]">{r.vendor_name}</td>
                    <td className="py-2 px-3 text-right">{fmt(r.amount)}</td>
                    <td className="py-2 px-3">
                      <span className={`badge ${r.days_past_due > 60 ? 'badge-red' : r.days_past_due > 30 ? 'badge-yellow' : 'badge-green'}`}>
                        {r.aging_bucket || `${r.days_past_due}d`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Bank Balances */}
      {bank.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-clipper-gold" />
            <h2 className="text-lg font-semibold text-clipper-black">Bank Balances</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {bank.map((b) => (
              <div key={b.id} className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                <div className="text-sm text-gray-500">{b.account_name}</div>
                <div className="text-xl font-bold mt-1">{fmt(b.current_balance)}</div>
                {b.as_of_date && <div className="text-xs text-gray-400 mt-1">as of {new Date(b.as_of_date).toLocaleDateString()}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
