// A radial production gauge: a ~270° gold arc that fills with current output, a
// glowing Sun at the center, and the live watts as the big center label. The arc
// geometry is pure (lib/solarGauge.js); this component just strokes it and layers
// the label on top (same svg + overlay approach as components/Donut.jsx). The
// svg is decorative (aria-hidden); the center label carries the value.
import { Sun } from 'lucide-react'
import { gaugeArc } from '../lib/solarGauge.js'
import { formatWatts, sunGlowFilter } from '../lib/solar.js'

export function SolarGauge({ watts, fraction = 0, glow = 0, size = 200, thickness = 16 }) {
  const g = gaugeArc(fraction, { size, thickness })

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id="solar-gauge-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fde047" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        {/* Track: the full 270° arc, dim. */}
        <path
          d={g.track}
          fill="none"
          stroke="currentColor"
          strokeWidth={thickness}
          strokeLinecap="round"
          className="text-slate-800"
        />
        {/* Value: the filled portion, gold gradient with a glow that grows with output. */}
        {g.value && (
          <path
            d={g.value}
            fill="none"
            stroke="url(#solar-gauge-grad)"
            strokeWidth={thickness}
            strokeLinecap="round"
            style={{ filter: sunGlowFilter(glow, { baseBlur: 6, blurGain: 14, baseAlpha: 0.25 }) }}
          />
        )}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <Sun
          className="mb-1 h-7 w-7 text-yellow-300"
          aria-hidden="true"
          style={{ filter: sunGlowFilter(glow) }}
        />
        <div className="text-2xl font-semibold tabular-nums text-slate-100">{formatWatts(watts)}</div>
        <div className="text-[11px] uppercase tracking-wide text-slate-400">producing</div>
      </div>
    </div>
  )
}
