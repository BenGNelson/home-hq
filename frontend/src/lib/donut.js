// Pure arc math for a hand-rolled SVG donut chart — no charting dependency.
// Kept dependency-free and deterministic so it's unit-testable in isolation.
// The component (components/Donut.jsx) just renders what this returns.

// Coerce anything dodgy (negative, NaN, non-number) to 0 — a chart slice can't
// have negative or undefined area.
function clean(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// A point on a circle of radius `r` centered at (cx, cy) at `angle` radians,
// measured clockwise from 12 o'clock (top). Screen-space y grows downward, so
// clockwise-from-top is (sin, -cos).
function pointOnCircle(cx, cy, r, angle) {
  return {
    x: cx + r * Math.sin(angle),
    y: cy - r * Math.cos(angle),
  }
}

const f = (n) => Number(n.toFixed(3))

// Build the SVG path for one annulus (donut) slice spanning [a0, a1] radians
// (clockwise from top), between inner radius `ri` and outer radius `ro`.
function arcPath(cx, cy, ri, ro, a0, a1) {
  const largeArc = a1 - a0 > Math.PI ? 1 : 0
  const o0 = pointOnCircle(cx, cy, ro, a0) // outer start
  const o1 = pointOnCircle(cx, cy, ro, a1) // outer end
  const i1 = pointOnCircle(cx, cy, ri, a1) // inner end (back-side)
  const i0 = pointOnCircle(cx, cy, ri, a0) // inner start
  // Outer arc sweeps clockwise (sweep-flag 1), inner arc back (sweep-flag 0).
  return [
    `M ${f(o0.x)} ${f(o0.y)}`,
    `A ${f(ro)} ${f(ro)} 0 ${largeArc} 1 ${f(o1.x)} ${f(o1.y)}`,
    `L ${f(i1.x)} ${f(i1.y)}`,
    `A ${f(ri)} ${f(ri)} 0 ${largeArc} 0 ${f(i0.x)} ${f(i0.y)}`,
    'Z',
  ].join(' ')
}

// A closed full ring (single 100% segment). One SVG `A` command can't draw a
// full 360° (start == end is a no-op), so stitch two half-circles for each
// edge of the annulus, using the even-odd fill rule via a hole subpath.
function fullRingPath(cx, cy, ri, ro) {
  const topO = pointOnCircle(cx, cy, ro, 0)
  const botO = pointOnCircle(cx, cy, ro, Math.PI)
  const topI = pointOnCircle(cx, cy, ri, 0)
  const botI = pointOnCircle(cx, cy, ri, Math.PI)
  return [
    // Outer circle (clockwise), two half-arcs.
    `M ${f(topO.x)} ${f(topO.y)}`,
    `A ${f(ro)} ${f(ro)} 0 1 1 ${f(botO.x)} ${f(botO.y)}`,
    `A ${f(ro)} ${f(ro)} 0 1 1 ${f(topO.x)} ${f(topO.y)}`,
    'Z',
    // Inner circle (counter-clockwise) punches the hole.
    `M ${f(topI.x)} ${f(topI.y)}`,
    `A ${f(ri)} ${f(ri)} 0 1 0 ${f(botI.x)} ${f(botI.y)}`,
    `A ${f(ri)} ${f(ri)} 0 1 0 ${f(topI.x)} ${f(topI.y)}`,
    'Z',
  ].join(' ')
}

// segmentsToArcs([{ label, value, color }], { size, thickness }) →
//   [{ label, color, value, pct, d }]
// `pct` is each segment's share of the total (0..1); `d` is its SVG path.
// Edge cases: empty input or total value 0 → []; a single 100% segment renders
// a closed full ring; negative/NaN values are treated as 0.
export function segmentsToArcs(segments, { size = 160, thickness = 28 } = {}) {
  if (!Array.isArray(segments) || segments.length === 0) return []

  const cleaned = segments.map((s) => ({ ...s, value: clean(s && s.value) }))
  const total = cleaned.reduce((sum, s) => sum + s.value, 0)
  if (total <= 0) return []

  const ro = size / 2
  const ri = Math.max(0, size / 2 - thickness)
  const cx = size / 2
  const cy = size / 2

  // Drop zero-value segments — they have no arc and would emit a degenerate path.
  const drawable = cleaned.filter((s) => s.value > 0)

  // Single segment owning the whole circle → full ring.
  if (drawable.length === 1) {
    const s = drawable[0]
    return [
      {
        label: s.label,
        color: s.color,
        value: s.value,
        pct: 1,
        d: fullRingPath(cx, cy, ri, ro),
      },
    ]
  }

  const TAU = Math.PI * 2
  let angle = 0
  return drawable.map((s) => {
    const pct = s.value / total
    const a0 = angle
    const a1 = angle + pct * TAU
    angle = a1
    return {
      label: s.label,
      color: s.color,
      value: s.value,
      pct,
      d: arcPath(cx, cy, ri, ro, a0, a1),
    }
  })
}
