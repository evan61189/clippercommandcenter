import { Routes, Route, Link } from 'react-router-dom'
import { Building2, FileText, CheckCircle, AlertTriangle } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import ProjectDetail from './pages/ProjectDetail'
import ReportDetail from './pages/ReportDetail'
import CloseoutItems from './pages/CloseoutItems'

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
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
            <div className="flex items-center space-x-4">
              <Link
                to="/"
                className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
              >
                <Building2 className="w-4 h-4" />
                <span>Projects</span>
              </Link>
              <Link
                to="/closeout-items"
                className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
              >
                <CheckCircle className="w-4 h-4" />
                <span>Closeout Items</span>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/project/:projectId" element={<ProjectDetail />} />
          <Route path="/report/:reportId" element={<ReportDetail />} />
          <Route path="/closeout-items" element={<CloseoutItems />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-center text-sm text-gray-500">
            Procore-QuickBooks Financial Closeout Reconciliation
          </p>
        </div>
      </footer>
    </div>
  )
}

export default App
