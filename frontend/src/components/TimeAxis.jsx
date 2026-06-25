import { formatClock } from '../lib/format.js'

// A compact time axis (first · mid · last) under a time-series chart. `times` are
// epoch MILLISECONDS aligned with the chart's points (multiply backend epoch-
// seconds by 1000 before passing). Fewer than 2 points → reserves the space so
// the layout doesn't jump once data arrives. `now` tags the last tick "(now)".
export function TimeAxis({ times, now = true }) {
  if (!times || times.length < 2) return <div className="mt-1 h-4" />
  const first = times[0]
  const mid = times[Math.floor(times.length / 2)]
  const last = times[times.length - 1]
  return (
    <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-500">
      <span>{formatClock(first)}</span>
      <span>{formatClock(mid)}</span>
      <span>
        {formatClock(last)}
        {now ? ' (now)' : ''}
      </span>
    </div>
  )
}
