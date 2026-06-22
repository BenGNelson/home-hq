import { graphPeak, graphLine } from '../lib/graph.js'

// A lightweight live line graph — no charting dependency, just SVG.
// `series` is [{ color, points: number[] }]; all series share one auto-scaled
// axis. The viewBox stretches to the container width (preserveAspectRatio
// "none"), and strokes use non-scaling-stroke so lines stay crisp. The peak /
// path math (and its null-coercion) lives in lib/graph.js so it's unit-tested.
export function Graph({ series, height = 56, heightClass = 'h-14' }) {
  const W = 100
  const peak = graphPeak(series)
  const hasData = series.some((s) => s.points.length > 0)
  const line = (points) => graphLine(points, peak, height, W)

  return (
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
}
