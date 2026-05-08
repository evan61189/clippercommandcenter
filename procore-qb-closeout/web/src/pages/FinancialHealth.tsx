import { Link } from 'react-router-dom'
import { Plug } from 'lucide-react'

export default function FinancialHealth() {
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
