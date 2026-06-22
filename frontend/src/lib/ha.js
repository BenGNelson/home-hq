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

// Resolve an entity to a Lucide icon + an accent color (a literal Tailwind text
// class so the JIT keeps it), chosen by device_class first (most specific), then
// domain, then a keyword in the id. `{ Icon: null }` when nothing matches (the
// widget shows a neutral dot). The color gives the glance a bit of flair without
// the fixed-full-color emoji it replaced.
function resolve(e) {
  const dc = e?.device_class || ''
  const domain = e?.domain || ''
  const id = e?.entity_id || ''
  if (dc === 'battery') return { Icon: Battery, color: 'text-emerald-400' }
  if (dc === 'battery_charging') return { Icon: Zap, color: 'text-yellow-400' }
  if (dc === 'humidity') return { Icon: Droplet, color: 'text-sky-400' }
  if (dc === 'temperature') return { Icon: Thermometer, color: 'text-orange-400' }
  if (dc === 'distance') return { Icon: Route, color: 'text-violet-400' }
  if (dc === 'motion' || dc === 'occupancy' || dc === 'presence')
    return { Icon: Footprints, color: 'text-cyan-400' }
  if (dc === 'door' || dc === 'garage_door' || dc === 'opening')
    return { Icon: DoorClosed, color: 'text-amber-400' }
  if (/washer|dryer|laundry/.test(id)) return { Icon: WashingMachine, color: 'text-sky-400' }
  if (/dehumidif|humidif/.test(id)) return { Icon: Droplet, color: 'text-sky-400' }
  if (/tesla|car|vehicle/.test(id)) return { Icon: Car, color: 'text-rose-400' }
  if (domain === 'lock') return { Icon: Lock, color: 'text-emerald-400' }
  if (domain === 'light') return { Icon: Lightbulb, color: 'text-amber-400' }
  if (domain === 'switch') return { Icon: Plug, color: 'text-lime-400' }
  if (domain === 'climate') return { Icon: Thermometer, color: 'text-orange-400' }
  if (domain === 'device_tracker' || domain === 'person')
    return { Icon: MapPin, color: 'text-violet-400' }
  if (domain === 'binary_sensor') return { Icon: Bell, color: 'text-slate-400' }
  return { Icon: null, color: 'text-slate-400' }
}

// The Lucide icon component for an entity (or null). See resolve().
export function entityIcon(e) {
  return resolve(e).Icon
}

// The accent color (Tailwind text class) for an entity's icon.
export function entityColor(e) {
  return resolve(e).color
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
