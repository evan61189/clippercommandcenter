import { Routes, Route, Link } from 'react-router-dom'
import { Building2, CheckCircle, Settings as SettingsIcon, Play } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import ProjectDetail from './pages/ProjectDetail'
import ReportDetail from './pages/ReportDetail'
import CloseoutItems from './pages/CloseoutItems'
import Settings from './pages/Settings'
import RunReconciliation from './pages/RunReconciliation'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'

function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link to="/" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-procore-blue rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-lg">$</span>
                </div>
                <span className="font-semibold text-xl text-gray-900">
                  Financial Closeout
                </span>
              </Link>
            </div>
            <div className="flex items-center space-x-2">
              <Link
                to="/"
                className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
              >
                <Building2 className="w-4 h-4" />
                <span>Dashboard</span>
              </Link>
              <Link
                to="/run"
                className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
              >
                <Play className="w-4 h-4" />
                <span>Run</span>
              </Link>
              <Link
                to="/closeout-items"
                className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
              >
                <CheckCircle className="w-4 h-4" />
                <span>Closeout Items</span>
              </Link>
              <Link
                to="/settings"
                className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
              >
                <SettingsIcon className="w-4 h-4" />
                <span>Settings</span>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/run" element={<RunReconciliation />} />
          <Route path="/project/:projectId" element={<ProjectDetail />} />
          <Route path="/report/:reportId" element={<ReportDetail />} />
          <Route path="/closeout-items" element={<CloseoutItems />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-center items-center space-x-4 text-sm text-gray-500">
            <span>Procore-QuickBooks Financial Closeout Reconciliation</span>
            <span>|</span>
            <Link to="/privacy" className="hover:text-gray-700">Privacy Policy</Link>
            <span>|</span>
            <Link to="/terms" className="hover:text-gray-700">Terms of Service</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default App
