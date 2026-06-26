// The reusable engine behind the "back-lit radiance" motif (see
// docs/ARCHITECTURE.md → "Visual motif: back-lit radiance"). Produces a CSS
// `drop-shadow` glow so an icon/element reads as a light source. `rgb` is an
// "r,g,b" string (a constant-palette color so it survives theme swaps);
// `intensity` (0..1) scales the blur + alpha. The knobs let each surface tune
// its look without re-spelling the rgba string.
export function glowFilter(
  rgb,
  intensity = 1,
  { baseBlur = 4, blurGain = 12, baseAlpha = 0.4, alphaGain = 0.5 } = {},
) {
  const g = Math.min(1, Math.max(0, Number(intensity) || 0))
  return `drop-shadow(0 0 ${baseBlur + g * blurGain}px rgba(${rgb},${(baseAlpha + g * alphaGain).toFixed(2)}))`
}

// A radiant backdrop gradient that fades to transparent, so a card glows in an
// accent color on top of any theme background. Pair with a faint accent border.
export function radiantBackdrop(rgb, alpha = 0.3) {
  return `radial-gradient(120% 120% at 50% -10%, rgba(${rgb},${alpha}), transparent 65%)`
}

// Centralized knobs for the "back-lit CARD" treatment (a dashboard widget lit by
// an accent color) — softer than the full-page heroes, which use radiantBackdrop
// directly at its brighter default. Tune these to dial every back-lit card up or
// down at once.
export const BACKLIT = { backdropAlpha: 0.16, borderAlpha: 0.35, dotIntensity: 0.7 }

// The inline style for a back-lit surface: a radiant backdrop fading to
// transparent + a faintly tinted border, both in the accent color (the fade lets
// the themed page show through, so it stays theme-safe). `rgb` is an "r,g,b"
// string. This is the one-liner that opts any card into the motif.
export function backlitSurface(rgb) {
  return {
    borderColor: `rgba(${rgb},${BACKLIT.borderAlpha})`,
    background: radiantBackdrop(rgb, BACKLIT.backdropAlpha),
  }
}

// The matching glowing "status dot" style — a small filled dot that reads as a
// little light source in the accent color (drop it beside a title).
export function backlitDot(rgb) {
  return {
    backgroundColor: `rgb(${rgb})`,
    filter: glowFilter(rgb, BACKLIT.dotIntensity, { baseBlur: 4, blurGain: 8, baseAlpha: 0.4 }),
  }
}
