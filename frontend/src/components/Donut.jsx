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
    // Stack on phones (chart on top, legend full-width below) so labels get the
    // whole width and don't truncate; side-by-side from sm up where there's room.
    <div className={`flex flex-col items-center gap-4 sm:flex-row ${className}`}>
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

      <ul className="w-full space-y-1.5 text-sm sm:min-w-0 sm:flex-1">
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
