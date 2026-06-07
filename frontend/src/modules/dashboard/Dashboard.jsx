import SystemWidget from './widgets/SystemWidget.jsx'
import DiskWidget from './widgets/DiskWidget.jsx'
import ContainersWidget from './widgets/ContainersWidget.jsx'
import PlexWidget from './widgets/PlexWidget.jsx'

// The Dashboard module: a responsive grid of independent widgets. Each widget
// fetches its own endpoint, so one failing source never blanks the others.
export default function Dashboard() {
  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Dashboard</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SystemWidget />
        <DiskWidget />
        <PlexWidget />
        <ContainersWidget />
      </div>
    </div>
  )
}
