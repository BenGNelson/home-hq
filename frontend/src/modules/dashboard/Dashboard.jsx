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

// The Dashboard module: a responsive grid of independent widgets. Each widget
// fetches its own endpoint, so one failing source never blanks the others.
export default function Dashboard() {
  return (
    <div>
      {/* Weather leads as a full-width "hero" banner above the grid (it self-hides
          when no location is configured) and links through to the Weather page. */}
      <WeatherWidget />

      {/* Masonry flow: cards pack vertically per column instead of aligning
          into rows, so a short card never leaves a gap under a tall neighbour.
          Two columns kick in at sm (640px) so a portrait tablet (e.g. iPad
          mini, 744px — just under Tailwind's md) uses both, not just phones in
          landscape; narrow phones stay single-column. */}
      <div className="columns-1 gap-4 sm:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
        <SystemWidget />
        <DiskWidget />
        <DrivesWidget />
        <PlexWidget />
        <ContainersWidget />
        <PrinterWidget />
        <SolarWidget />
        <AdGuardWidget />
        <HomeWidget />
        <TailscaleWidget />
        <SpeedtestWidget />
      </div>
    </div>
  )
}
