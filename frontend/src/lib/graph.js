// Pure geometry helpers for the SVG <Graph> component. Kept here so the
// null-coercion and scaling math are unit-tested and the component stays
// presentational.

// Coerce any non-finite value (null / undefined / NaN) to 0. Without this a
// single bad sample poisons Math.max (→ NaN), which then poisons every y
// coordinate and silently blanks the whole chart.
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0)

// Auto-scaled peak across every series' points, floored at 1 so a flat-zero
// series still has a valid axis (and never divides by zero).
export function graphPeak(series) {
  return Math.max(1, ...series.flatMap((s) => s.points.map(num)))
}

// SVG path string for one series, scaled into [0..width] × [0..height] with y
// inverted (0 at the bottom). Empty points → ''; a single point → a flat line.
export function graphLine(points, peak, height, width) {
  if (points.length === 0) return ''
  if (points.length === 1) {
    const y = height - (num(points[0]) / peak) * height
    return `M0,${y.toFixed(2)} L${width},${y.toFixed(2)}`
  }
  return points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * width
      const y = height - (num(v) / peak) * height
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}
