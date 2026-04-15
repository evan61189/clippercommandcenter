import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Calendar, Plug } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface Project {
  id: string; name: string; code: string; status: string;
  original_contract_value: number; current_contract_value: number;
  start_date: string; estimated_completion_date: string; address: any;
}

const formatCurrency = (val: number | null) => {
  if (!val) return '$0'
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`
  return `$${val.toLocaleString()}`
}

const statusColors: Record<string, string> = {
  active: 'badge-green', planning: 'badge-blue', pre_construction: 'badge-yellow',
  completed: 'badge-gray', on_hold: 'badge-red', closed: 'badge-gray',
}

export default function ProjectPortfolio() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('projects').select('*').order('updated_at', { ascending: false })
      if (data) setProjects(data)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clipper-gold" /></div>
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-clipper-black">Project Portfolio</h1>
          <p className="text-sm text-gray-500 mt-1">{projects.length} projects</p>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16">
          <Plug className="w-12 h-12 text-gray-300 mb-3" />
          <p className="text-lg font-medium text-gray-700">No projects yet</p>
          <p className="text-sm text-gray-500 mt-1">Connect Procore to sync your active projects, or create one manually.</p>
          <Link to="/settings" className="btn btn-gold mt-4">Connect Procore</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((project) => (
            <Link key={project.id} to={`/projects/${project.id}`}
              className="card hover:shadow-md transition-shadow cursor-pointer group">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <span className="text-xs font-medium text-gray-500">{project.code}</span>
                  <h3 className="text-base font-semibold text-clipper-black group-hover:text-clipper-gold-dark transition-colors">
                    {project.name}
                  </h3>
                </div>
                <span className={`badge ${statusColors[project.status] || 'badge-gray'}`}>
                  {project.status.replace('_', ' ')}
                </span>
              </div>

              <div className="text-xl font-bold text-clipper-black mb-3">
                {formatCurrency(project.current_contract_value || project.original_contract_value)}
              </div>

              <div className="space-y-1.5 text-xs text-gray-500">
                {project.start_date && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{new Date(project.start_date).toLocaleDateString()} — {project.estimated_completion_date ? new Date(project.estimated_completion_date).toLocaleDateString() : 'TBD'}</span>
                  </div>
                )}
                {project.address && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{typeof project.address === 'string' ? project.address : project.address?.city || 'Location TBD'}</span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
