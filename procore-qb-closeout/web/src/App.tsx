import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Briefcase, Settings as SettingsIcon, LogOut, ChevronLeft, ChevronRight, Ship
} from 'lucide-react'
import { useState } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import CompanyOverview from './pages/CompanyOverview'
import ProjectDeepDive from './pages/ProjectDeepDive'
import Settings from './pages/Settings'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'

const navItems = [
  { path: '/', label: 'Projects', icon: Briefcase },
  { path: '/settings', label: 'Settings', icon: SettingsIcon },
]

function Sidebar({ collapsed, setCollapsed }: { collapsed: boolean; setCollapsed: (v: boolean) => void }) {
  const location = useLocation()

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/' || location.pathname.startsWith('/projects')
    return location.pathname.startsWith(path)
  }

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-56'} bg-clipper-black min-h-screen flex flex-col transition-all duration-200 relative`}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-gray-800">
        <div className="w-8 h-8 bg-clipper-gold rounded-lg flex items-center justify-center flex-shrink-0">
          <Ship className="w-5 h-5 text-clipper-black" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <div className="text-white font-bold text-sm leading-tight">CLIPPER</div>
            <div className="text-clipper-gold text-[10px] font-medium tracking-wider">COMMAND TERMINAL</div>
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {navItems.map(({ path, label, icon: Icon }) => (
          <Link
            key={path}
            to={path}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive(path)
                ? 'bg-clipper-gold text-clipper-black'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
            title={collapsed ? label : undefined}
          >
            <Icon className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span>{label}</span>}
          </Link>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 w-6 h-6 bg-clipper-black border border-gray-700 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:border-clipper-gold transition-colors z-10"
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
      </button>
    </aside>
  )
}

function TopBar() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <div>
        <h1 className="text-sm font-semibold text-gray-900">
          Clipper Construction
        </h1>
        <p className="text-xs text-gray-500">Command Terminal</p>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-500">{user?.email}</span>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-1 text-gray-500 hover:text-red-600 text-sm transition-colors"
          title="Sign Out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  )
}

function AppLayout() {
  const { user } = useAuth()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Public routes (no sidebar)
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />
      <div className="flex-1 flex flex-col min-h-screen">
        <TopBar />
        <main className="flex-1 p-6 overflow-auto bg-gray-50">
          <Routes>
            <Route path="/" element={<ProtectedRoute><CompanyOverview /></ProtectedRoute>} />
            <Route path="/projects/:projectId" element={<ProtectedRoute><ProjectDeepDive /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
          </Routes>
        </main>
      </div>
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
