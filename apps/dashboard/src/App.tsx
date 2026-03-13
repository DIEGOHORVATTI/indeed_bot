import { Routes, Route, NavLink } from 'react-router-dom'
import OverviewPage from './pages/overview'
import JobsPage from './pages/jobs'
import JobDetailPage from './pages/job-detail'
import PlatformsPage from './pages/platforms'
import SearchesPage from './pages/searches'
import CvsPage from './pages/cvs'
import SettingsPage from './pages/settings'
const navLinks = [
  { to: '/', label: 'Visão Geral' },
  { to: '/jobs', label: 'Vagas' },
  { to: '/cvs', label: 'Currículos' },
  { to: '/settings', label: 'Perfil' },
  { to: '/searches', label: 'Buscas' },
  { to: '/platforms', label: 'Plataformas' },
]

export function App() {
  return (
    <>
      <nav className="bg-card border-b border-border px-6 py-3 flex items-center gap-6">
        <h1 className="text-xl font-bold text-foreground">JobPilot</h1>
        {navLinks.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `text-sm ${isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <main className="p-6">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:id" element={<JobDetailPage />} />
          <Route path="/cvs" element={<CvsPage />} />
          <Route path="/platforms" element={<PlatformsPage />} />
          <Route path="/searches" element={<SearchesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </>
  )
}
