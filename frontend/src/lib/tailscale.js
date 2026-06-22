// Pure helpers for the /api/tailscale payload, so the page just renders. Kept
// here (not in the component) to stay unit-tested.

import { Monitor, Smartphone, Laptop, MonitorDot } from 'lucide-react'

// A single headline verdict for the mesh, driving color + label.
export function tailscaleVerdict(t) {
  if (!t || t.available === false) return { tone: 'idle', label: 'Not configured' }
  if (t.status === 'unavailable')
    return { tone: 'idle', label: 'Tailscale not running' }
  if (t.stale) return { tone: 'idle', label: 'Stale — checker not running' }
  if (t.status === 'down') return { tone: 'bad', label: 'Disconnected' }
  return { tone: 'good', label: 'Connected' }
}

// A short human one-liner explaining the verdict.
export function tailscaleExplanation(t) {
  if (!t || t.available === false)
    return 'No Tailscale data yet — the host check hasn’t run (see the Server Guide).'
  if (t.status === 'unavailable')
    return 'Tailscale isn’t installed or logged in on this host, so there’s no mesh to show.'
  if (t.stale)
    return 'The status checker hasn’t reported recently, so online states may be out of date.'
  if (t.status === 'down')
    return 'This host isn’t connected to the tailnet right now.'
  const n = t.online_count ?? 0
  const total = t.peer_count ?? 0
  return `Connected to the tailnet — ${n} of ${total} other device${total === 1 ? '' : 's'} online.`
}

// Map a Tailscale OS string to a Lucide icon component for the device list.
// Lucide has no OS-brand logos, so OS strings map to generic device types — the
// OS name text stays on screen, so the icon is just a device hint. Returns a
// component (render as <Icon/>), never a raw string.
const OS_ICONS = {
  linux: Monitor,
  macos: Monitor,
  windows: Monitor,
  desktop: Monitor,
  ios: Smartphone,
  iphone: Smartphone,
  android: Smartphone,
  phone: Smartphone,
  laptop: Laptop,
}
export function osIcon(os) {
  return OS_ICONS[String(os || '').toLowerCase()] ?? MonitorDot
}
