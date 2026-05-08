import { Link } from 'react-router-dom'
import { GitCompare } from 'lucide-react'

export default function Reconciliation() {
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
