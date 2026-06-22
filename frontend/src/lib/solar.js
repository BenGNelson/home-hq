// Pure helpers for the Solar module — value formatting + the unavailable
// message. Kept here (not in the component) so they're unit-tested.

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
