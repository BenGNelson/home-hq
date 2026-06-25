// Pure helpers for the per-panel array view. A panel cell is colored by its
// current output relative to the best-producing panel right now, so a shaded or
// underperforming panel reads dim next to its bright neighbors.

// The reference peak across panels (the best current output), floored at 1 so an
// all-dark array (night) doesn't divide by zero.
export function panelsPeak(panels) {
  const ws = (panels || []).map((p) => Number(p.watts) || 0)
  return Math.max(1, ...ws)
}

// A panel's fill: slate when idle/none, else amber whose alpha scales with output
// (0.18 → 1.0) relative to `peak`. Returns a CSS color string.
export function panelColor(watts, peak) {
  const w = Number(watts)
  const p = Number(peak) > 0 ? Number(peak) : 1
  if (!Number.isFinite(w) || w <= 0) return 'rgba(148,163,184,0.12)' // slate — idle/none
  const frac = Math.min(1, w / p)
  return `rgba(245,158,11,${(0.18 + frac * 0.82).toFixed(2)})` // amber 0.18..1
}
