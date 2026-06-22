// A reusable hand-rolled SVG donut chart — no charting dependency. The arc math
// lives in lib/donut.js (pure + tested); this component just renders it plus a
// textual legend. Colors are caller-supplied (the consuming page passes a
// palette). The svg is decorative (aria-hidden); the legend carries the data
// for accessibility.
import { segmentsToArcs } from '../lib/donut.js'

const fmtPct = (pct) => `${Math.round(pct * 100)}%`

export function Donut({
  segments,
  size = 160,
  thickness = 28,
  centerLabel,
  className = '',
}) {
  const arcs = segmentsToArcs(segments, { size, thickness })

  // Nothing to draw (no segments, or all zero) → muted placeholder.
  if (arcs.length === 0) {
    return (
      <div
        className={`flex items-center justify-center text-sm text-slate-500 ${className}`}
        style={{ minHeight: size }}
      >
        No data
      </div>
    )
  }

  return (
    <div className={`flex flex-wrap items-center gap-4 ${className}`}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          aria-hidden="true"
        >
          {arcs.map((arc, i) => (
            <path key={i} d={arc.d} fill={arc.color} fillRule="evenodd" />
          ))}
        </svg>
        {centerLabel != null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center">
            {centerLabel}
          </div>
        )}
      </div>

      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {arcs.map((arc, i) => (
          <li key={i} className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: arc.color }}
            />
            <span className="min-w-0 flex-1 truncate text-slate-300">{arc.label}</span>
            <span className="text-slate-400">{arc.value}</span>
            <span className="w-10 text-right tabular-nums text-slate-500">
              {fmtPct(arc.pct)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
