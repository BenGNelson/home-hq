// Pure helpers for the Solar module — value formatting + the unavailable
// message. Kept here (not in the component) so they're unit-tested.

import { glowFilter } from './glow.js'

// Power: small values in W, larger in kW (2 decimals). Sign is preserved so a
// negative net (importing) formats with its minus.
export function formatWatts(w) {
  if (w == null) return '—'
  if (Math.abs(w) >= 1000) return `${(w / 1000).toFixed(2)} kW`
  return `${Math.round(w)} W`
}

// Energy: watt-hours -> kWh (one decimal). The Envoy reports Wh.
export function formatKwh(wh) {
  if (wh == null) return '—'
  return `${(wh / 1000).toFixed(1)} kWh`
}

// A compact wall-clock label ("1:35p") from epoch milliseconds — for the
// peak-production time on the day's curve. '' for null/invalid input.
export function clockLabel(ms) {
  if (ms == null) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  let h = d.getHours()
  const m = d.getMinutes()
  const period = h < 12 ? 'a' : 'p'
  h = h % 12 === 0 ? 12 : h % 12
  return `${h}:${String(m).padStart(2, '0')}${period}`
}

// A metered system's net flow, as a human label. Positive = exporting surplus to
// the grid, negative = importing from it, ~0 = balanced.
export function netLabel(netWatts) {
  if (netWatts == null) return null
  if (netWatts > 0) return { text: `Exporting ${formatWatts(netWatts)}`, tone: 'text-emerald-400' }
  if (netWatts < 0) return { text: `Importing ${formatWatts(-netWatts)}`, tone: 'text-amber-400' }
  return { text: 'Balanced', tone: 'text-slate-400' }
}

export function solarUnavailableMessage(reason) {
  if (reason === 'not_configured') return 'Solar isn’t configured yet.'
  if (reason === 'unreachable') return 'Can’t reach the Envoy gateway right now.'
  return 'Solar data is unavailable.'
}

// A soft residential reference peak (W) for the gauge/glow when we have no
// observed history yet — so a fresh install still shows a sensible fill. Once
// the sampler has data, the page passes the observed peak instead.
export const SOLAR_REF_PEAK = 6000

// How full the production gauge is (0..1): current watts over a reference peak.
// Clamped; non-positive / non-finite inputs → 0 (an idle gauge).
export function gaugeFraction(watts, refPeak = SOLAR_REF_PEAK) {
  const w = Number(watts)
  const peak = Number(refPeak) > 0 ? Number(refPeak) : SOLAR_REF_PEAK
  if (!Number.isFinite(w) || w <= 0) return 0
  return Math.min(1, w / peak)
}

// Glow strength (0..1) for the gauge's sun/halo — same scale as the gauge fill.
export function glowIntensity(watts, refPeak = SOLAR_REF_PEAK) {
  return gaugeFraction(watts, refPeak)
}

// A warm sun-glow `drop-shadow` whose blur + alpha grow with `glow` (0..1) — the
// solar (amber) preset of the shared back-lit glow. One definition for the gauge
// arc, the gauge sun, and the dashboard widget.
export function sunGlowFilter(glow, opts = {}) {
  return glowFilter('250,204,21', glow, opts) // yellow-300
}

// Model the 4-node energy-flow diagram (Solar · Battery · Grid · Home) from the
// backend `power` block ({solar,grid,battery,load}, each {watts,dir}). Returns the
// nodes to show + directed edges, each with a tone and whether it's actively
// flowing (drives the animation). Battery is included only when present; without
// a `power` block at all (older payload / non-metered) it degrades to empty.
export function flowModel(power) {
  if (!power) return { nodes: [], edges: [], hasBattery: false }

  const solarW = power.solar?.watts ?? 0
  const grid = power.grid
  const battery = power.battery
  const hasBattery = !!battery

  const nodes = ['solar', 'home', 'grid']
  if (hasBattery) nodes.push('battery')

  const edges = [
    // Solar → Home: producing (active whenever there's output).
    { id: 'solar-home', from: 'solar', to: 'home', tone: 'gold', watts: power.solar?.watts ?? null, active: solarW > 0 },
  ]

  if (hasBattery) {
    if (battery.dir === 'charging') {
      // Charging: power flows Solar → Battery (storing the surplus).
      edges.push({ id: 'solar-battery', from: 'solar', to: 'battery', tone: 'green', watts: battery.watts, active: true })
    } else if (battery.dir === 'discharging') {
      // Discharging: Battery → Home (supplying the house).
      edges.push({ id: 'battery-home', from: 'battery', to: 'home', tone: 'green', watts: battery.watts, active: true })
    } else {
      edges.push({ id: 'battery-home', from: 'battery', to: 'home', tone: 'slate', watts: 0, active: false })
    }
  }

  if (grid) {
    if (grid.dir === 'importing') {
      edges.push({ id: 'grid-home', from: 'grid', to: 'home', tone: 'amber', watts: grid.watts, active: true })
    } else if (grid.dir === 'exporting') {
      edges.push({ id: 'home-grid', from: 'home', to: 'grid', tone: 'emerald', watts: grid.watts, active: true })
    } else {
      edges.push({ id: 'grid-home', from: 'grid', to: 'home', tone: 'slate', watts: 0, active: false })
    }
  }

  return { nodes, edges, hasBattery }
}

// Two-bar comparison (today's produced vs used) as 0..1 widths relative to the
// larger of the two, so the bigger bar is full and the other is proportional.
// null when neither has data (nothing meaningful to draw).
export function barPair(prodWh, consWh) {
  const p = Number(prodWh)
  const c = Number(consWh)
  const pv = Number.isFinite(p) && p > 0 ? p : 0
  const cv = Number.isFinite(c) && c > 0 ? c : 0
  const max = Math.max(pv, cv)
  if (max <= 0) return null
  return { prod: pv / max, cons: cv / max }
}
