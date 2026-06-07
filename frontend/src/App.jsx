import { Routes, Route, Navigate } from 'react-router-dom'
import Shell from './shell/Shell.jsx'
import Dashboard from './modules/dashboard/Dashboard.jsx'

// The module registry. Each module declares its nav entry here and a matching
// <Route> below. Adding a module later = one entry + one route, nothing else.
// This is the seam the whole platform grows along.
export const modules = [
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: '▦' },
]

export default function App() {
  return (
    <Shell modules={modules}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </Shell>
  )
}
