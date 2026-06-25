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

// Slice the flat panel list into the configured set sizes (the system's physical
// arrays), so each renders as its own block. Any leftover (count mismatch) becomes
// a trailing set; empty sets are dropped. With no/invalid sizes → one set.
export function splitSets(panels, sizes) {
  const list = panels || []
  if (!Array.isArray(sizes) || sizes.length === 0) return list.length ? [list] : []
  const sets = []
  let i = 0
  for (const n of sizes) {
    sets.push(list.slice(i, i + n))
    i += n
  }
  if (i < list.length) sets.push(list.slice(i)) // leftover panels → their own set
  return sets.filter((s) => s.length > 0)
}

// Columns for an evenly-filled rectangle of `n` cells: the largest divisor of n
// that's ≤ max (so the rows are full, no ragged trailing gap). A prime > max
// (no neat divisor) falls back to `max` columns (remainder row is centered).
export function evenCols(n, max = 9) {
  for (let c = Math.min(n, max); c >= 2; c--) if (n % c === 0) return c
  return Math.min(Math.max(n, 1), max)
}
