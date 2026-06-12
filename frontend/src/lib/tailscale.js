// Pure helpers for the /api/tailscale payload, so the page just renders. Kept
// here (not in the component) to stay unit-tested.

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

// Map a Tailscale OS string to a small glyph for the device list.
const OS_ICONS = {
  linux: '🐧',
  ios: '📱',
  iphone: '📱',
  android: '🤖',
  macos: '🍎',
  windows: '🪟',
}
export function osIcon(os) {
  return OS_ICONS[String(os || '').toLowerCase()] ?? '💻'
}
