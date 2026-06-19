// Small presentational building blocks reused across widgets.

// A spinning indicator for "this is loading / updating".
export function Spinner({ label = 'loading…' }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-slate-300" />
      {label}
    </div>
  )
}

// A pulsing placeholder block — the building piece for skeleton loading states.
// Size it with utility classes (w-/h-) to mirror the real content it stands in
// for, so swapping the real data in causes no layout shift. Always pass a height
// (no default, to avoid two conflicting h-* classes on one element).
export function SkeletonLine({ className = '' }) {
  return (
    <span className={`block animate-pulse rounded bg-slate-700/60 ${className}`} />
  )
}

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
