import { useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function ProjectDeepDive() {
  const { projectId } = useParams()
  const [project, setProject] = useState<any>(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!projectId) return
      const { data } = await supabase.from('projects').select('*').eq('id', projectId).single()
      if (data) setProject(data)
      setLoading(false)
    }
    load()
  }, [projectId])

  const tabs = ['overview', 'budget', 'rfis', 'submittals', 'daily_logs', 'punch_items', 'change_orders', 'safety']

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clipper-gold" /></div>
  }

  if (!project) {
    return <div className="text-center py-16 text-gray-500">Project not found</div>
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center gap-3">
        <Link to="/projects" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </Link>
        <div>
          <span className="text-xs text-gray-500">{project.code}</span>
          <h1 className="text-2xl font-bold text-clipper-black">{project.name}</h1>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors capitalize ${
                activeTab === tab
                  ? 'border-clipper-gold text-clipper-black'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.replace('_', ' ')}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content placeholder */}
      <div className="card">
        <p className="text-gray-500 text-center py-8">
          {activeTab.charAt(0).toUpperCase() + activeTab.slice(1).replace('_', ' ')} view — data will populate once Procore sync is connected.
        </p>
      </div>
    </div>
  )
}
