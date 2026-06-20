// Pure presentation helpers for the Home Assistant glance widget. The backend
// (/api/ha) returns curated entities already normalized ({entity_id, domain,
// name, state, unit, device_class}); these just turn one into something to show.
// Kept pure (no globals) so they're unit-tested. Display only — no control.

// A small emoji for an entity, chosen by device_class first (most specific),
// then domain, then a keyword in the id. Falls back to a neutral dot.
export function entityIcon(e) {
  const dc = e?.device_class || ''
  const domain = e?.domain || ''
  const id = e?.entity_id || ''
  if (dc === 'battery') return '🔋'
  if (dc === 'humidity') return '💧'
  if (dc === 'temperature') return '🌡️'
  if (dc === 'motion' || dc === 'occupancy' || dc === 'presence') return '🚶'
  if (dc === 'door' || dc === 'garage_door' || dc === 'opening') return '🚪'
  if (/washer|dryer|laundry/.test(id)) return '🧺'
  if (/dehumidif|humidif/.test(id)) return '💧'
  if (/tesla|car|vehicle/.test(id)) return '🚗'
  if (domain === 'lock') return '🔒'
  if (domain === 'light') return '💡'
  if (domain === 'switch') return '🔌'
  if (domain === 'climate') return '🌡️'
  if (domain === 'device_tracker' || domain === 'person') return '📍'
  if (domain === 'binary_sensor') return '🔔'
  return '•'
}

// A human label for a row: the friendly name when present, else a prettified id.
export function entityLabel(e) {
  if (e?.name) return e.name
  const id = e?.entity_id || ''
  const tail = id.includes('.') ? id.split('.').slice(1).join('.') : id
  return tail.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Title-case a couple of common bare states so "on"/"off" read nicely; leave
// anything else (numbers, "Running", "home") as-is.
const STATE_LABELS = {
  on: 'On',
  off: 'Off',
  home: 'Home',
  not_home: 'Away',
  open: 'Open',
  closed: 'Closed',
  locked: 'Locked',
  unlocked: 'Unlocked',
  unavailable: '—',
  unknown: '—',
}

// The value to show on the right of a row: state plus its unit when it reads as
// a number (so "42 min", "15%"), otherwise a friendlier label for bare states.
export function entityValue(e) {
  const raw = (e?.state ?? '').toString().trim()
  if (raw === '') return '—'
  const lower = raw.toLowerCase()
  if (lower in STATE_LABELS) return STATE_LABELS[lower]
  const unit = e?.unit
  if (unit && isNumeric(raw)) {
    // No space before a percent sign, a thin gap before word units.
    return unit === '%' ? `${raw}%` : `${raw} ${unit}`
  }
  return raw
}

function isNumeric(s) {
  return s !== '' && !Number.isNaN(Number(s))
}

// True when a battery entity has dropped to/below the threshold — the widget
// tints these so a low battery stands out at a glance.
export function lowBattery(e, threshold = 20) {
  if (e?.device_class !== 'battery') return false
  const n = Number(e?.state)
  return !Number.isNaN(n) && n <= threshold
}
