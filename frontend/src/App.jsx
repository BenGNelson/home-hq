import { Routes, Route, Navigate } from 'react-router-dom'
import Shell from './shell/Shell.jsx'
import Dashboard from './modules/dashboard/Dashboard.jsx'
import Plex from './modules/plex/Plex.jsx'
import LibraryBrowser from './modules/plex/LibraryBrowser.jsx'
import ShowBrowser from './modules/plex/ShowBrowser.jsx'
import MovieDetail from './modules/plex/MovieDetail.jsx'
import Containers from './modules/containers/Containers.jsx'
import Printer from './modules/printer/Printer.jsx'
import Network from './modules/network/Network.jsx'
import Backups from './modules/backups/Backups.jsx'
import Alerts from './modules/alerts/Alerts.jsx'
import Guide from './modules/guide/Guide.jsx'
import Readme from './modules/readme/Readme.jsx'
import ServerGuide from './modules/server-guide/ServerGuide.jsx'

// The module registry. Each module declares its nav entry here and a matching
// <Route> below. Adding a module = one entry + one route, nothing else.
// This is the seam the whole platform grows along.
const modules = [
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: '▦' },
  { id: 'plex', label: 'Plex', path: '/plex', icon: '►' },
  { id: 'containers', label: 'Containers', path: '/containers', icon: '▣' },
  { id: 'printer', label: 'Printer', path: '/printer', icon: '⎙' },
  { id: 'network', label: 'Network', path: '/network', icon: '⇅' },
  { id: 'backups', label: 'Backups', path: '/backups', icon: '⤓' },
  { id: 'alerts', label: 'Alerts', path: '/alerts', icon: '⚑' },
  { id: 'guide', label: 'Under the Hood', path: '/guide', icon: 'ⓘ' },
]

export default function App() {
  return (
    <Shell modules={modules}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/plex" element={<Plex />} />
        <Route path="/plex/library/:key" element={<LibraryBrowser />} />
        <Route path="/plex/show/:key" element={<ShowBrowser />} />
        <Route path="/plex/movie/:key" element={<MovieDetail />} />
        <Route path="/containers" element={<Containers />} />
        <Route path="/printer" element={<Printer />} />
        <Route path="/network" element={<Network />} />
        <Route path="/backups" element={<Backups />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/guide" element={<Guide />} />
        <Route path="/readme" element={<Readme />} />
        <Route path="/server-guide" element={<ServerGuide />} />
      </Routes>
    </Shell>
  )
}
