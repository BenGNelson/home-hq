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

// Model the energy-flow diagram from a live snapshot: which nodes to show and
// the directed edges between them, each with a tone and whether it's actively
// flowing (drives the animation). Non-metered systems can't know grid flow, so
// they show only the Sun → Home leg.
export function flowModel(production, consumption, netWatts, metered) {
  const prod = production?.watts_now ?? null
  const producing = (prod ?? 0) > 0

  const edges = [
    // Sun → Home: solar feeding the house, active whenever producing.
    { id: 'solar-home', from: 'solar', to: 'home', tone: 'gold', watts: prod, active: producing },
  ]

  if (metered) {
    if (netWatts == null) {
      // Net flow unknown (a transient partial read) — a dim link with no value,
      // distinct from a genuine net-zero so we don't claim "balanced" falsely.
      edges.push({ id: 'grid-home', from: 'grid', to: 'home', tone: 'slate', watts: null, active: false })
    } else if (netWatts > 0) {
      // Surplus flows Home → Grid (exporting).
      edges.push({ id: 'home-grid', from: 'home', to: 'grid', tone: 'emerald', watts: netWatts, active: true })
    } else if (netWatts < 0) {
      // Drawing from the grid: Grid → Home (importing).
      edges.push({ id: 'grid-home', from: 'grid', to: 'home', tone: 'amber', watts: -netWatts, active: true })
    } else {
      // Genuinely balanced (net exactly zero): a dim, idle grid link.
      edges.push({ id: 'grid-home', from: 'grid', to: 'home', tone: 'slate', watts: 0, active: false })
    }
  }

  return {
    metered: !!metered,
    nodes: metered ? ['solar', 'home', 'grid'] : ['solar', 'home'],
    edges,
  }
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
