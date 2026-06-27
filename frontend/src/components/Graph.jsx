import { graphBounds, graphLine } from '../lib/graph.js'
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
//   peakMarker    {index, label} → a dot on the first series at that point + the
//                 label appended to the "peak" readout (e.g. the time it occurred)
export function Graph({
  series,
  height = 56,
  heightClass = 'h-14',
  unit,
  formatValue,
  legend,
  times,
  caption,
  peakMarker,
  zeroBaseline = true,
}) {
  const W = 100
  // Bottom/top of the value axis. zeroBaseline:false zooms to the data so a
  // barely-moving high signal still shows its fluctuation (see graphBounds).
  const { floor, top, peak, low } = graphBounds(series, { zeroBaseline })
  const hasData = series.some((s) => s.points.length > 0)
  const line = (points) => graphLine(points, top, height, W, floor)

  // Position of the peak dot on the first series (kept round via a CSS overlay
  // rather than an SVG <circle>, which the non-uniform x-scaling would distort).
  // `value` is that series' value at the marker, so the readout pairs it with the
  // marker's time (not the global cross-series max, which may be another line).
  const pts = series[0]?.points ?? []
  const dot =
    peakMarker && hasData && pts.length > 1
      ? (() => {
          const i = Math.min(Math.max(peakMarker.index ?? 0, 0), pts.length - 1)
          const v = Number(pts[i]) || 0
          return {
            left: (i / (pts.length - 1)) * 100,
            top: (1 - (v - floor) / (top - floor)) * 100,
            color: series[0].color,
            value: v,
          }
        })()
      : null

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

  const labeled =
    unit != null || formatValue != null || legend != null || times != null || caption != null || peakMarker != null
  if (!labeled) return svg

  // With a marker, report the marked series' value at that point (consistent with
  // the marker's time label); otherwise the auto-scaled cross-series peak.
  const fmt = (x) => (formatValue ? formatValue(x) : `${Math.round(x)}${unit ? ` ${unit}` : ''}`)
  const readout = dot ? dot.value : peak
  // On a zoomed (non-zero-baseline) chart with no marker, show the actual value
  // window (low–peak) so the line isn't misread as touching zero.
  const peakLabel =
    !zeroBaseline && !peakMarker
      ? `${fmt(low)}–${fmt(peak)}`
      : `peak ${fmt(readout)}${peakMarker?.label ? ` · ${peakMarker.label}` : ''}`

  return (
    <div>
      <div className="mb-1 flex items-end justify-between gap-3 text-[10px] text-slate-500">
        <span className="tabular-nums">{peakLabel}</span>
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
      <div className="relative">
        {svg}
        {dot && (
          <span
            className="pointer-events-none absolute h-2 w-2 rounded-full ring-2 ring-slate-950/40"
            style={{
              left: `${dot.left}%`,
              top: `${dot.top}%`,
              transform: 'translate(-50%, -50%)',
              backgroundColor: dot.color,
              boxShadow: `0 0 6px ${dot.color}`,
            }}
          />
        )}
      </div>
      {times ? (
        <TimeAxis times={times} />
      ) : caption ? (
        <div className="mt-1 text-right text-[10px] text-slate-500">{caption}</div>
      ) : null}
    </div>
  )
}
