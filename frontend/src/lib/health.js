// Map sustained-resource pressure to a back-lit accent color (an "r,g,b" string)
// for the System hero: emerald when calm → amber when stressed → rose when
// critical. We key off the WORST of the passed percentages, and deliberately feed
// it the sustained signals (memory + disk) rather than CPU, which spikes every
// poll and would make the hue flicker. Pure so the thresholds are unit-tested.

const EMERALD = '52,211,153' // emerald-400 — healthy
const AMBER = '251,191,36' // amber-400 — under pressure
const ROSE = '248,113,113' // rose-400 — critical

export function healthAccent(...percents) {
  const vals = percents.filter((p) => typeof p === 'number' && Number.isFinite(p))
  const worst = vals.length ? Math.max(...vals) : 0
  if (worst >= 90) return ROSE
  if (worst >= 75) return AMBER
  return EMERALD
}
