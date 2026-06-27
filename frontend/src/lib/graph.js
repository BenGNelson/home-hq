// Pure geometry helpers for the SVG <Graph> component. Kept here so the
// null-coercion and scaling math are unit-tested and the component stays
// presentational.

// Coerce any non-finite value (null / undefined / NaN) to 0. Without this a
// single bad sample poisons Math.max (→ NaN), which then poisons every y
// coordinate and silently blanks the whole chart.
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0)

// The vertical bounds a chart is drawn into: { floor, top } (the value mapped to
// the bottom / top edges), plus { peak, low } = the actual max / min for labels.
//
// Default (zeroBaseline) keeps the honest 0→max axis. With zeroBaseline:false the
// axis ZOOMS to the data — floor a padded step below the min (never < 0), top a
// padded step above the max — so a signal that barely moves relative to its
// magnitude (e.g. a rock-solid ~940 Mbps line) still shows its fluctuation
// instead of hugging the top. The pad has a magnitude-tied minimum (top*0.02) so
// a dead-flat line gets a readable band rather than a sliver, while 10-30-unit
// swings use real vertical space.
export function graphBounds(series, { zeroBaseline = true } = {}) {
  const nums = series.flatMap((s) => s.points.map(num))
  const top = Math.max(1, ...nums)
  if (zeroBaseline || nums.length === 0) return { floor: 0, top, peak: top, low: 0 }
  const low = Math.min(...nums)
  const pad = Math.max((top - low) * 0.25, top * 0.02)
  return { floor: Math.max(0, low - pad), top: top + pad, peak: top, low }
}

// SVG path string for one series, scaled into [0..width] × [floor..top] with y
// inverted (floor at the bottom). `floor` defaults to 0 (the classic zero-based
// axis). Values outside [floor, top] are clamped to the edges. Empty points →
// ''; a single point → a flat line.
export function graphLine(points, top, height, width, floor = 0) {
  if (points.length === 0) return ''
  const span = top - floor || 1
  const yOf = (v) => {
    const frac = (num(v) - floor) / span
    const c = frac < 0 ? 0 : frac > 1 ? 1 : frac
    return height - c * height
  }
  if (points.length === 1) {
    const y = yOf(points[0]).toFixed(2)
    return `M0,${y} L${width},${y}`
  }
  return points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * width
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${yOf(v).toFixed(2)}`
    })
    .join(' ')
}
