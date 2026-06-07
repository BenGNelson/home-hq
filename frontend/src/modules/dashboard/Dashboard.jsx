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
      {/* Masonry flow: cards pack vertically per column instead of aligning
          into rows, so a short card never leaves a gap under a tall neighbour. */}
      <div className="columns-1 gap-4 md:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
        <SystemWidget />
        <DiskWidget />
        <PlexWidget />
        <ContainersWidget />
      </div>
    </div>
  )
}
