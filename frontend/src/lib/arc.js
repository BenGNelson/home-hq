// Shared circle/arc geometry for the hand-rolled SVG charts (donut, gauge). Kept
// in one place so the angle convention + rounding can't drift between them.

// A point on a circle of radius `r` centered at (cx, cy) at `angle` radians,
// measured clockwise from 12 o'clock (top). Screen-space y grows downward, so
// clockwise-from-top is (sin, -cos).
export function pointOnCircle(cx, cy, r, angle) {
  return {
    x: cx + r * Math.sin(angle),
    y: cy - r * Math.cos(angle),
  }
}

// Round to 3 decimals for compact, stable SVG path strings.
export const f = (n) => Number(n.toFixed(3))
