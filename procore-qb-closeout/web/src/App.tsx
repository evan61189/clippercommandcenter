import { Routes, Route, Link, useNavigate } from 'react-router-dom'
import { Building2, Settings as SettingsIcon, Play, LogOut, Calendar, FolderCheck, PauseCircle, FileBarChart } from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Dashboard from './pages/Dashboard'
import ProjectDetail from './pages/ProjectDetail'
import ReportDetail from './pages/ReportDetail'
import Settings from './pages/Settings'
import RunReconciliation from './pages/RunReconciliation'
import MonthEndCloseouts from './pages/MonthEndCloseouts'
import ProjectCloseouts from './pages/ProjectCloseouts'
import SoftClosedProjects from './pages/SoftClosedProjects'
import WIPReports from './pages/WIPReports'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'

function AppLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Navigation - only show when logged in */}
      {user && (
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
                  to="/month-end-closeouts"
                  className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
                >
                  <Calendar className="w-4 h-4" />
                  <span>Month-End Closeouts</span>
                </Link>
                <Link
                  to="/project-closeouts"
                  className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
                >
                  <FolderCheck className="w-4 h-4" />
                  <span>Project Closeouts</span>
                </Link>
                <Link
                  to="/soft-closed"
                  className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
                >
                  <PauseCircle className="w-4 h-4" />
                  <span>Soft Closed</span>
                </Link>
                <Link
                  to="/wip-reports"
                  className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
                >
                  <FileBarChart className="w-4 h-4" />
                  <span>WIP Reports</span>
                </Link>
                <Link
                  to="/run"
                  className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
                >
                  <Play className="w-4 h-4" />
                  <span>Run</span>
                </Link>
                <Link
                  to="/settings"
                  className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
                >
                  <SettingsIcon className="w-4 h-4" />
                  <span>Settings</span>
                </Link>
                <div className="border-l border-gray-200 h-6 mx-2" />
                <div className="flex items-center space-x-3">
                  <span className="text-sm text-gray-500">{user.email}</span>
                  <button
                    onClick={handleSignOut}
                    className="flex items-center space-x-1 text-gray-600 hover:text-red-600 px-3 py-2 rounded-md text-sm font-medium"
                    title="Sign Out"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </nav>
      )}

      {/* Main Content */}
      <main className={user ? "flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8" : "flex-1"}>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />

          {/* Protected routes */}
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/run" element={<ProtectedRoute><RunReconciliation /></ProtectedRoute>} />
          <Route path="/month-end-closeouts" element={<ProtectedRoute><MonthEndCloseouts /></ProtectedRoute>} />
          <Route path="/project-closeouts" element={<ProtectedRoute><ProjectCloseouts /></ProtectedRoute>} />
          <Route path="/soft-closed" element={<ProtectedRoute><SoftClosedProjects /></ProtectedRoute>} />
          <Route path="/wip-reports" element={<ProtectedRoute><WIPReports /></ProtectedRoute>} />
          <Route path="/project/:projectId" element={<ProtectedRoute><ProjectDetail /></ProtectedRoute>} />
          <Route path="/report/:reportId" element={<ProtectedRoute><ReportDetail /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        </Routes>
      </main>

      {/* Footer - only show when logged in */}
      {user && (
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
      )}
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppLayout />
    </AuthProvider>
  )
}

export default App
