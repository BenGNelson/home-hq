import { Sunrise, Sunset, Sun, Moon } from 'lucide-react'
import { sunFraction, timeLabel } from '../lib/weather.js'
import { glowFilter } from '../lib/glow.js'

// A gentle dawn→dusk arc with the sun riding along it at the location's current
// time (or a moon at night), bracketed by the sunrise/sunset times. Part of the
// Weather hero's "lit by the sky" language. Pure-presentational; the daylight
// fraction math is sunFraction() in lib/weather.js (unit-tested).
//
// The sun/moon is an absolutely-positioned element (not an SVG <circle>) so it
// stays perfectly round despite the arc's non-uniform horizontal scaling.
export function SunArc({ sunrise, sunset, now, isDay = true }) {
  if (!sunrise || !sunset) return null
  const frac = sunFraction(sunrise, sunset, now)
  // Quadratic Bézier P0(6,30) → control(50,2) → P1(94,30) in a 100×34 viewBox;
  // evaluate it at t = daylight fraction. At night (or when we can't place it) the
  // fraction is clamped to an endpoint, which is meaningless for the moon — so we
  // rest it at the apex (0.5) rather than pinning it to the sunrise/sunset bracket.
  const t = !isDay || frac == null ? 0.5 : frac
  const bz = (a, b, c) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c
  const x = bz(6, 50, 94)
  const y = bz(30, 2, 30)

  return (
    <div className="select-none">
      <div className="relative h-12 w-full">
        <svg viewBox="0 0 100 34" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
          <path
            d="M6,30 Q50,2 94,30"
            fill="none"
            stroke="currentColor"
            className="text-slate-700"
            strokeWidth="1"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div
          className="absolute"
          style={{ left: `${x}%`, top: `${(y / 34) * 100}%`, transform: 'translate(-50%, -50%)' }}
        >
          {isDay ? (
            <Sun
              className="h-5 w-5 text-amber-300"
              aria-hidden="true"
              style={{ filter: glowFilter('251,191,36', 0.8, { baseBlur: 6, blurGain: 14, baseAlpha: 0.25 }) }}
            />
          ) : (
            <Moon
              className="h-4 w-4 text-slate-300"
              aria-hidden="true"
              style={{ filter: glowFilter('148,163,184', 0.4, { baseBlur: 4, blurGain: 8, baseAlpha: 0.2 }) }}
            />
          )}
        </div>
      </div>
      <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400">
        <span className="flex items-center gap-1">
          <Sunrise className="h-3.5 w-3.5 text-amber-300/80" aria-hidden="true" />
          {timeLabel(sunrise)}
        </span>
        <span className="flex items-center gap-1">
          {timeLabel(sunset)}
          <Sunset className="h-3.5 w-3.5 text-orange-300/80" aria-hidden="true" />
        </span>
      </div>
    </div>
  )
}
