// Map ntfy tag shortcodes (what the backend sends) to a Lucide icon component to
// show in-app, so the Alerts page reads the same as the phone notification.
// Returns a component (rendered as <Icon .../>), falling back to a bell.
import {
  HardDriveDownload,
  Siren,
  HardDrive,
  Database,
  Plug,
  Container,
  Printer,
  TriangleAlert,
  SatelliteDish,
  MonitorDot,
  CircleCheck,
  Bell,
} from 'lucide-react'

const ICONS = {
  floppy_disk: HardDriveDownload, // 💾 backup
  rotating_light: Siren, // 🚨 raid
  minidisc: HardDrive, // 💽 smart
  card_file_box: Database, // 🗄️ storage/capacity/db
  electric_plug: Plug, // 🔌 drive/watchdog
  package: Container, // 📦 container
  printer: Printer, // 🖨 printer
  warning: TriangleAlert, // ⚠ hms/warn
  satellite: SatelliteDish, // 🛰 offline
  desktop_computer: MonitorDot, // 🖥 host/heartbeat
  white_check_mark: CircleCheck, // ✅ resolved
}

// The Lucide icon component for an alert tag (falls back to a bell).
export function alertIcon(tag) {
  return ICONS[tag] || Bell
}
