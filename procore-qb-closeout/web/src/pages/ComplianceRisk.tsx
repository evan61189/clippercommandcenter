import { Shield } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function ComplianceRisk() {
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
