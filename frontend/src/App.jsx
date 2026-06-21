import { Routes, Route, Navigate } from 'react-router-dom'
import Shell from './shell/Shell.jsx'
import Dashboard from './modules/dashboard/Dashboard.jsx'
import Plex from './modules/plex/Plex.jsx'
import LibraryBrowser from './modules/plex/LibraryBrowser.jsx'
import ShowBrowser from './modules/plex/ShowBrowser.jsx'
import MovieDetail from './modules/plex/MovieDetail.jsx'
import PlexInsights from './modules/plex/Insights.jsx'
import Library from './modules/library/Library.jsx'
import LibraryLayout from './modules/library/LibraryLayout.jsx'
import GamesList from './modules/library/GamesList.jsx'
import GameDetail from './modules/library/GameDetail.jsx'
import Player from './modules/library/Player.jsx'
import PapersList from './modules/library/PapersList.jsx'
import BooksList from './modules/library/BooksList.jsx'
import ComicsList from './modules/library/ComicsList.jsx'
import AudiobooksList from './modules/library/AudiobooksList.jsx'
import Reader from './modules/library/Reader.jsx'
import Downloads from './modules/library/Downloads.jsx'
import Containers from './modules/containers/Containers.jsx'
import Printer from './modules/printer/Printer.jsx'
import Network from './modules/network/Network.jsx'
import Vpn from './modules/vpn/Vpn.jsx'
import Tailscale from './modules/tailscale/Tailscale.jsx'
import Storage from './modules/storage/Storage.jsx'
import Backups from './modules/backups/Backups.jsx'
import Alerts from './modules/alerts/Alerts.jsx'
import Uptime from './modules/uptime/Uptime.jsx'
import Guide from './modules/guide/Guide.jsx'
import Readme from './modules/readme/Readme.jsx'
import ServerGuide from './modules/server-guide/ServerGuide.jsx'
import { hostNavLinks } from './lib/hostLocal.js'
import {
  Home,
  Clapperboard,
  Library as LibraryIcon,
  Container,
  HardDrive,
  Archive,
  Globe,
  ShieldCheck,
  Waypoints,
  Printer as PrinterIcon,
  Bell,
  Activity,
  Wrench,
  BookText,
  Braces,
  FileText,
} from 'lucide-react'

// The module registry. Each module declares its nav entry here and a matching
// <Route> below. Adding a module = one entry + one route, nothing else.
// `group` decides which labeled sidebar section it lands in (Shell renders the
// sections in the order groups first appear here). The Docs group is reference
// material, not functional modules — Shell pins it to the bottom of the sidebar.
// This is the seam the whole platform grows along.
// Icons are Lucide components (monochrome line icons that inherit the theme's
// text color, unlike the old fixed-color emoji). Shell renders them as <Icon/>.
const builtinModules = [
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: Home, group: 'Overview' },
  { id: 'plex', label: 'Plex', path: '/plex', icon: Clapperboard, group: 'Media' },
  { id: 'library', label: 'Library', path: '/library', icon: LibraryIcon, group: 'Media' },
  { id: 'containers', label: 'Containers', path: '/containers', icon: Container, group: 'System' },
  { id: 'storage', label: 'Storage', path: '/storage', icon: HardDrive, group: 'System' },
  { id: 'backups', label: 'Backups', path: '/backups', icon: Archive, group: 'System' },
  { id: 'network', label: 'Network', path: '/network', icon: Globe, group: 'Network' },
  { id: 'vpn', label: 'VPN', path: '/vpn', icon: ShieldCheck, group: 'Network' },
  { id: 'tailscale', label: 'Tailscale', path: '/tailscale', icon: Waypoints, group: 'Network' },
  { id: 'printer', label: '3D Printer', path: '/printer', icon: PrinterIcon, group: 'Devices' },
  { id: 'alerts', label: 'Alerts', path: '/alerts', icon: Bell, group: 'Monitoring' },
  { id: 'uptime', label: 'Uptime', path: '/uptime', icon: Activity, group: 'Monitoring' },
  { id: 'guide', label: 'Under the Hood', path: '/guide', icon: Wrench, group: 'Docs' },
  { id: 'server-guide', label: 'Your Server Guide', path: '/server-guide', icon: BookText, group: 'Docs' },
  // External: the backend's own interactive OpenAPI docs (Swagger UI), served
  // at /api/docs through the same proxy as the API. `external` makes Shell
  // render a plain <a> that opens in a new tab — it's not a React route, so
  // there's no matching <Route> below.
  { id: 'api', label: 'API', path: '/api/docs', icon: Braces, group: 'Docs', external: true },
  { id: 'readme', label: 'README', path: '/readme', icon: FileText, group: 'Docs' },
]

// Host-local external deep-links (e.g. Home Assistant) appended to the registry.
// They carry a `group` like any module, so groupModules folds them into the
// right sidebar section regardless of position; absent host.local.jsx, this is
// empty and nothing extra renders. These are external <a> links, not routes —
// HQ deep-links to HA for control rather than rebuilding a smart-home UI.
const modules = [...builtinModules, ...hostNavLinks()]

export default function App() {
  return (
    <Shell modules={modules}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/plex" element={<Plex />} />
        <Route path="/plex/insights" element={<PlexInsights />} />
        <Route path="/plex/library/:key" element={<LibraryBrowser />} />
        <Route path="/plex/show/:key" element={<ShowBrowser />} />
        <Route path="/plex/movie/:key" element={<MovieDetail />} />
        <Route path="/library" element={<Library />} />
        {/* The section list pages share a persistent layout so the section
            switcher (LibraryNav) stays mounted as you hop between them — no
            unmount/remount flicker. Detail/player/reader routes stay outside
            it (they never showed the switcher). */}
        <Route element={<LibraryLayout />}>
          <Route path="/library/games" element={<GamesList />} />
          <Route path="/library/papers" element={<PapersList />} />
          <Route path="/library/books" element={<BooksList />} />
          <Route path="/library/comics" element={<ComicsList />} />
          <Route path="/library/audiobooks" element={<AudiobooksList />} />
        </Route>
        <Route path="/library/games/detail" element={<GameDetail />} />
        <Route path="/library/play" element={<Player />} />
        <Route path="/library/read" element={<Reader />} />
        <Route path="/library/downloads" element={<Downloads />} />
        <Route path="/containers" element={<Containers />} />
        <Route path="/printer" element={<Printer />} />
        <Route path="/network" element={<Network />} />
        <Route path="/vpn" element={<Vpn />} />
        <Route path="/tailscale" element={<Tailscale />} />
        <Route path="/storage" element={<Storage />} />
        <Route path="/backups" element={<Backups />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/uptime" element={<Uptime />} />
        <Route path="/guide" element={<Guide />} />
        <Route path="/readme" element={<Readme />} />
        <Route path="/server-guide" element={<ServerGuide />} />
      </Routes>
    </Shell>
  )
}
