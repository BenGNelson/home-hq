// Small presentational building blocks reused across widgets.
import { ArrowUpRight } from 'lucide-react'

// The "go to page" affordance for a clickable card: a ↗ that fades in on hover
// and tints to the card's `--accent`. Decorative + pointer-events-none, so a
// click on it still falls through to the card's stretched-link overlay and
// navigates. Pass `className` for positioning (inline in a header, or absolute).
export function AccentArrow({ className = '' }) {
  return (
    <ArrowUpRight
      className={`pointer-events-none h-4 w-4 text-slate-600 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-hover:[color:var(--accent)] ${className}`}
      aria-hidden="true"
    />
  )
}

// A spinning indicator for "this is loading / updating".
export function Spinner({ label = 'loading…' }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-400">
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

// A generic widget loading placeholder: `rows` label/value lines and `bars`
// progress-bar shapes, in the common "rows then bars" order (set `barsFirst`
// for the usage-bar-on-top widgets like Storage). Sized to roughly match a
// card's real body so the data swaps in without a big jump. Widgets with a
// bespoke layout can still pass their own node instead.
const _ROW_WIDTHS = ['w-16', 'w-20', 'w-14', 'w-24', 'w-16', 'w-20']

export function WidgetSkeleton({ rows = 0, bars = 0, barsFirst = false }) {
  // The h-5 wrappers make each row/bar-label the height of a real text-sm line
  // (20px), so the placeholder body matches the real card's height — no grow on
  // load — even though the pulse bars themselves are thinner than the text.
  const rowEls = Array.from({ length: rows }, (_, i) => (
    <div key={`r${i}`} className="flex h-5 items-center justify-between">
      <SkeletonLine className={`h-4 ${_ROW_WIDTHS[i % _ROW_WIDTHS.length]}`} />
      <SkeletonLine className="h-4 w-24" />
    </div>
  ))
  const barEls = Array.from({ length: bars }, (_, i) => (
    <div key={`b${i}`}>
      <div className="mb-1 flex h-5 items-center justify-between">
        <SkeletonLine className="h-3 w-14" />
        <SkeletonLine className="h-3 w-20" />
      </div>
      <SkeletonLine className="h-2 w-full rounded-full" />
    </div>
  ))
  return (
    <div className="space-y-3 text-sm" aria-hidden="true">
      {barsFirst ? [...barEls, ...rowEls] : [...rowEls, ...barEls]}
    </div>
  )
}

// An outbound "Open ↗" link to a service's own web UI (new tab). Used to hand
// off from HQ (the read-only cockpit) to a service's full dashboard for control
// — e.g. AdGuard's admin UI. Renders nothing when there's no href, so callers
// can pass an unconfigured link and simply show nothing.
export function OpenLink({ href, label = 'Open', className = '' }) {
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-emerald-400 transition hover:bg-slate-800 ${className}`}
    >
      {label} ↗
    </a>
  )
}

// A small status dot — emerald when "ok" (running / online), muted slate when
// not. The one shared indicator so the shade can't drift between widgets.
export function StatusDot({ ok, className = '' }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${
        ok ? 'bg-emerald-500' : 'bg-slate-600'
      } ${className}`}
    />
  )
}

// A label/value line.
export function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-100">{value}</span>
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
