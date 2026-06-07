// A lightweight live line graph — no charting dependency, just SVG.
// `series` is [{ color, points: number[] }]; all series share one auto-scaled
// axis. The viewBox stretches to the container width (preserveAspectRatio
// "none"), and strokes use non-scaling-stroke so lines stay crisp.
export function Graph({ series, height = 56, heightClass = 'h-14' }) {
  const W = 100
  const peak = Math.max(1, ...series.flatMap((s) => s.points))
  const hasData = series.some((s) => s.points.length > 0)

  const line = (points) => {
    if (points.length === 0) return ''
    if (points.length === 1) {
      const y = height - (points[0] / peak) * height
      return `M0,${y.toFixed(2)} L${W},${y.toFixed(2)}`
    }
    return points
      .map((v, i) => {
        const x = (i / (points.length - 1)) * W
        const y = height - (v / peak) * height
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
      })
      .join(' ')
  }

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
