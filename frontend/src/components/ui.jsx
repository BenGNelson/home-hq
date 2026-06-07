// Small presentational building blocks reused across widgets.

// A label/value line.
export function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-100">{value}</dd>
    </div>
  )
}

// A labeled progress bar that turns amber/red as it fills.
export function Bar({ label, percent, caption }) {
  const pct = Math.min(100, Math.max(0, percent ?? 0))
  const color = pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-slate-400">{label}</span>
        <span className="text-xs text-slate-400">{caption}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
