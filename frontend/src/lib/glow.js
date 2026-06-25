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
