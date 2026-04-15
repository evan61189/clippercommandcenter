import { useEffect, useState } from 'react'
// Icons available for future use
import { supabase } from '../lib/supabase'

interface StaffMember {
  id: string; first_name: string; last_name: string; email: string; role: string;
  max_capacity_slots: number; slots_used: number; slots_available: number;
  utilization_percent: number; active_project_count: number; active_projects: string[] | null;
}

function UtilizationBar({ percent }: { percent: number }) {
  const colorClass = percent >= 100 ? 'bg-red-500' : percent >= 75 ? 'bg-orange-500' : percent >= 50 ? 'bg-clipper-gold' : 'bg-emerald-500'
  return (
    <div className="w-32 bg-gray-200 rounded-full h-2.5">
      <div className={`${colorClass} h-2.5 rounded-full transition-all`} style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  )
}

export default function ResourceManagement() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('staff_utilization').select('*')
      if (data) setStaff(data)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clipper-gold" /></div>
  }

  const pms = staff.filter(s => s.role === 'project_manager')
  const supers = staff.filter(s => s.role === 'superintendent')

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-clipper-black">Resource Management</h1>
          <p className="text-sm text-gray-500 mt-1">Staff utilization, assignments, and capacity planning</p>
        </div>
      </div>

      {/* Capacity Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Project Managers</div>
          <div className="text-2xl font-bold mt-1">{pms.length} active</div>
          <div className="text-sm text-gray-500 mt-1">
            {pms.reduce((s, p) => s + p.slots_used, 0)}/{pms.reduce((s, p) => s + p.max_capacity_slots, 0)} slots filled
          </div>
        </div>
        <div className="stat-card">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Superintendents</div>
          <div className="text-2xl font-bold mt-1">{supers.length} active</div>
          <div className="text-sm text-gray-500 mt-1">
            {supers.reduce((s, p) => s + p.slots_used, 0)}/{supers.reduce((s, p) => s + p.max_capacity_slots, 0)} slots filled
          </div>
        </div>
      </div>

      {/* Staff Grid */}
      <div className="card">
        <h2 className="text-lg font-semibold text-clipper-black mb-4">Staff Roster</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="table-header py-2 pr-4">Name</th>
              <th className="table-header py-2 px-3">Role</th>
              <th className="table-header py-2 px-3">Email</th>
              <th className="table-header py-2 px-3">Utilization</th>
              <th className="table-header py-2 px-3 text-right">Slots</th>
              <th className="table-header py-2 px-3">Active Projects</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-3 pr-4 font-medium">{s.first_name} {s.last_name}</td>
                <td className="py-3 px-3">
                  <span className={`badge ${s.role === 'project_manager' ? 'badge-blue' : 'badge-green'}`}>
                    {s.role === 'project_manager' ? 'PM' : 'Super'}
                  </span>
                </td>
                <td className="py-3 px-3 text-gray-500">{s.email}</td>
                <td className="py-3 px-3">
                  <div className="flex items-center gap-2">
                    <UtilizationBar percent={s.utilization_percent} />
                    <span className="text-xs font-medium">{s.utilization_percent}%</span>
                  </div>
                </td>
                <td className="py-3 px-3 text-right font-medium">{s.slots_used}/{s.max_capacity_slots}</td>
                <td className="py-3 px-3 text-gray-500 text-xs">
                  {s.active_projects && s.active_projects.length > 0
                    ? s.active_projects.join(', ')
                    : 'Available'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
