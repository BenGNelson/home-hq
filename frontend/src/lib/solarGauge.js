// Pure geometry for the radial production gauge (components/SolarGauge.jsx).
// A ~270° arc open at the bottom: it starts at the lower-left, sweeps clockwise
// over the top, and ends at the lower-right. Kept dependency-free + deterministic
// so it's unit-tested in isolation; the component just strokes the paths.
import { pointOnCircle as pt, f } from './arc.js'

// 270° gauge starting 135° before top (lower-left) and sweeping clockwise.
const START = -(3 * Math.PI) / 4
const SWEEP = (3 * Math.PI) / 2

// A stroked centerline arc from angle a0 to a1 (clockwise from top, radians).
function arc(cx, cy, r, a0, a1) {
  const p0 = pt(cx, cy, r, a0)
  const p1 = pt(cx, cy, r, a1)
  const largeArc = a1 - a0 > Math.PI ? 1 : 0
  return `M ${f(p0.x)} ${f(p0.y)} A ${f(r)} ${f(r)} 0 ${largeArc} 1 ${f(p1.x)} ${f(p1.y)}`
}

// gaugeArc(fraction, {size, thickness}) → { size, thickness, radius, fraction,
//   track, value }. `track` is the full 270° arc; `value` is the filled portion
// (empty string at fraction 0). `fraction` is clamped to [0, 1].
export function gaugeArc(fraction, { size = 200, thickness = 16 } = {}) {
  const frac = Math.min(1, Math.max(0, Number(fraction) || 0))
  const r = size / 2 - thickness / 2
  const cx = size / 2
  const cy = size / 2
  return {
    size,
    thickness,
    radius: r,
    fraction: frac,
    track: arc(cx, cy, r, START, START + SWEEP),
    value: frac > 0 ? arc(cx, cy, r, START, START + SWEEP * frac) : '',
  }
}
