import { useMediaQuery } from '../../lib/useMediaQuery.js'
import { splitColumns } from '../../lib/dashboardLayout.js'
import SystemWidget from './widgets/SystemWidget.jsx'
import DiskWidget from './widgets/DiskWidget.jsx'
import DrivesWidget from './widgets/DrivesWidget.jsx'
import ContainersWidget from './widgets/ContainersWidget.jsx'
import PrinterWidget from './widgets/PrinterWidget.jsx'
import SolarWidget from './widgets/SolarWidget.jsx'
import AdGuardWidget from './widgets/AdGuardWidget.jsx'
import WeatherWidget from './widgets/WeatherWidget.jsx'
import HomeWidget from './widgets/HomeWidget.jsx'
import PlexWidget from './widgets/PlexWidget.jsx'
import TailscaleWidget from './widgets/TailscaleWidget.jsx'
import SpeedtestWidget from './widgets/SpeedtestWidget.jsx'

// The dashboard's widget layout, as a single ordered list — the one source of
// truth for both layouts:
//  - ARRAY ORDER is the phone (single-column) order, top to bottom.
//  - `col` places the widget in the left/right column on wider screens; within
//    a column the widgets keep their array order (see splitColumns).
// Each widget fetches its own endpoint, so one failing source never blanks the
// others. Membership in a column is FIXED here, so widgets never jump between
// columns as they load (the old CSS multi-column flow re-balanced by height,
// which is what made the grid shift around while it settled). Optional widgets
// that self-hide when unconfigured generally sit low in their column so an
// absent one doesn't shove the cards above it — the exception is Solar, placed
// at the TOP of the right column (and above Plex on phones) by preference; on a
// setup without solar that slot collapses, an accepted trade for the placement.
const WIDGETS = [
  { Comp: SystemWidget, col: 'left' },
  { Comp: SolarWidget, col: 'right' },
  { Comp: PlexWidget, col: 'right' },
  { Comp: ContainersWidget, col: 'left' },
  { Comp: DiskWidget, col: 'right' },
  { Comp: DrivesWidget, col: 'left' },
  { Comp: PrinterWidget, col: 'right' },
  { Comp: AdGuardWidget, col: 'left' },
  { Comp: HomeWidget, col: 'right' },
  { Comp: TailscaleWidget, col: 'right' },
  { Comp: SpeedtestWidget, col: 'left' },
]

// The split is invariant (membership is fixed by the `col` tag), so compute it
// once at module load instead of on every render.
const { left: LEFT, right: RIGHT } = splitColumns(WIDGETS)

function Column({ widgets }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      {widgets.map(({ Comp }, i) => (
        <Comp key={i} />
      ))}
    </div>
  )
}

export default function Dashboard() {
  // Two columns from sm (640px) up — a portrait iPad mini (744px) uses both,
  // narrow phones collapse to the single ordered list. Driving this off a JS
  // breakpoint (rather than CSS columns) lets us keep fixed per-widget placement
  // so nothing reflows between columns while the cards load. The trade: actually
  // crossing 640px (resizing a desktop window, or rotating a phone to a wide
  // landscape) swaps the one-column tree for the two-column one and remounts the
  // widgets, so they briefly re-skeleton and refetch. Harmless for these
  // read-only glances, and the devices that matter (desktop, tablet) sit well
  // clear of the line.
  const twoCol = useMediaQuery('(min-width: 640px)')

  return (
    <div>
      {/* Weather leads as a full-width "hero" banner above the grid (it
          self-hides when no location is configured) and links to the Weather
          page. It carries its own skeleton, so it never shifts on load. */}
      <WeatherWidget />

      {twoCol ? (
        <div className="flex items-start gap-4">
          <Column widgets={LEFT} />
          <Column widgets={RIGHT} />
        </div>
      ) : (
        <Column widgets={WIDGETS} />
      )}
    </div>
  )
}
