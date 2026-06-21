// Pure presentation helpers for the Home Assistant glance widget. The backend
// (/api/ha) returns curated entities already normalized ({entity_id, domain,
// name, state, unit, device_class}); these just turn one into something to show.
// Kept pure (no globals) so they're unit-tested. Display only — no control.

import {
  Battery,
  Zap,
  Droplet,
  Thermometer,
  Route,
  Footprints,
  DoorClosed,
  WashingMachine,
  Car,
  Lock,
  Lightbulb,
  Plug,
  MapPin,
  Bell,
} from 'lucide-react'

// A Lucide icon component for an entity, chosen by device_class first (most
// specific), then domain, then a keyword in the id. Returns null when nothing
// matches (the widget shows a neutral dot). Monochrome — inherits the text
// color, so it themes/dims cleanly (the old emoji were fixed full-color).
export function entityIcon(e) {
  const dc = e?.device_class || ''
  const domain = e?.domain || ''
  const id = e?.entity_id || ''
  if (dc === 'battery') return Battery
  if (dc === 'battery_charging') return Zap
  if (dc === 'humidity') return Droplet
  if (dc === 'temperature') return Thermometer
  if (dc === 'distance') return Route
  if (dc === 'motion' || dc === 'occupancy' || dc === 'presence') return Footprints
  if (dc === 'door' || dc === 'garage_door' || dc === 'opening') return DoorClosed
  if (/washer|dryer|laundry/.test(id)) return WashingMachine
  if (/dehumidif|humidif/.test(id)) return Droplet
  if (/tesla|car|vehicle/.test(id)) return Car
  if (domain === 'lock') return Lock
  if (domain === 'light') return Lightbulb
  if (domain === 'switch') return Plug
  if (domain === 'climate') return Thermometer
  if (domain === 'device_tracker' || domain === 'person') return MapPin
  if (domain === 'binary_sensor') return Bell
  return null
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
  if (isNumeric(raw)) {
    // HA reports some numbers raw (e.g. "63.1833333333333" minutes); round for
    // display so the glance stays tidy.
    const v = roundForDisplay(raw)
    const unit = e?.unit
    if (!unit) return v
    // No space before a percent sign, a thin gap before word units.
    return unit === '%' ? `${v}%` : `${v} ${unit}`
  }
  return raw
}

function isNumeric(s) {
  return s !== '' && !Number.isNaN(Number(s))
}

// Round a numeric string to at most one decimal place, dropping a trailing
// ".0" so whole numbers stay whole ("20.0" -> "20", "63.18…" -> "63.2").
function roundForDisplay(s) {
  return String(Math.round(Number(s) * 10) / 10)
}

// True when a battery entity has dropped to/below the threshold — the widget
// tints these so a low battery stands out at a glance.
export function lowBattery(e, threshold = 20) {
  if (e?.device_class !== 'battery') return false
  const n = Number(e?.state)
  return !Number.isNaN(n) && n <= threshold
}
