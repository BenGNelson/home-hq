import { Routes, Route, Navigate } from 'react-router-dom'
import Shell from './shell/Shell.jsx'
import Dashboard from './modules/dashboard/Dashboard.jsx'
import Plex from './modules/plex/Plex.jsx'
import Containers from './modules/containers/Containers.jsx'

// The module registry. Each module declares its nav entry here and a matching
// <Route> below. Adding a module = one entry + one route, nothing else.
// This is the seam the whole platform grows along.
const modules = [
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: '▦' },
  { id: 'plex', label: 'Plex', path: '/plex', icon: '►' },
  { id: 'containers', label: 'Containers', path: '/containers', icon: '▣' },
]

export default function App() {
  return (
    <Shell modules={modules}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/plex" element={<Plex />} />
        <Route path="/containers" element={<Containers />} />
      </Routes>
    </Shell>
  )
}
