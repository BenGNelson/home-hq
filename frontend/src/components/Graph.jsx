import { graphPeak, graphLine } from '../lib/graph.js'
import { TimeAxis } from './TimeAxis.jsx'

// A lightweight live line graph — no charting dependency, just SVG.
// `series` is [{ color, points: number[] }]; all series share one auto-scaled
// axis. The viewBox stretches to the container width (preserveAspectRatio
// "none"), and strokes use non-scaling-stroke so lines stay crisp. The peak /
// path math (and its null-coercion) lives in lib/graph.js so it's unit-tested.
//
// Optional labels (all backward-compatible — omit them and nothing changes):
//   unit          a unit string appended to the peak value ("Mbps", "°C", "W")
//   formatValue   a fn(peak)->string for non-trivial units (bytes/rate/watts);
//                 overrides `unit`
//   legend        [{label, color}] → a compact swatch row (which line is which)
//   times         epoch-MS aligned with the points → renders a time axis below
//   caption       a small bottom-right note (e.g. "last ~2 min") when there's no
//                 absolute time axis (live moving-window charts)
export function Graph({
  series,
  height = 56,
  heightClass = 'h-14',
  unit,
  formatValue,
  legend,
  times,
  caption,
}) {
  const W = 100
  const peak = graphPeak(series)
  const hasData = series.some((s) => s.points.length > 0)
  const line = (points) => graphLine(points, peak, height, W)

  const svg = (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className={`${heightClass} w-full rounded-md bg-slate-950/40`}
    >
      {hasData &&
        series.map((s, i) => (
          <g key={i}>
            <path
              d={`${line(s.points)} L${W},${height} L0,${height} Z`}
              fill={s.color}
              opacity="0.12"
            />
            <path
              d={line(s.points)}
              fill="none"
              stroke={s.color}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
    </svg>
  )

  const labeled = unit != null || formatValue != null || legend != null || times != null || caption != null
  if (!labeled) return svg

  const peakLabel = formatValue ? formatValue(peak) : `${Math.round(peak)}${unit ? ` ${unit}` : ''}`

  return (
    <div>
      <div className="mb-1 flex items-end justify-between gap-3 text-[10px] text-slate-500">
        <span className="tabular-nums">peak {peakLabel}</span>
        {legend && (
          <span className="flex flex-wrap justify-end gap-x-3 gap-y-0.5">
            {legend.map((l, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: l.color }} />
                <span className="text-slate-400">{l.label}</span>
              </span>
            ))}
          </span>
        )}
      </div>
      {svg}
      {times ? (
        <TimeAxis times={times} />
      ) : caption ? (
        <div className="mt-1 text-right text-[10px] text-slate-500">{caption}</div>
      ) : null}
    </div>
  )
}
