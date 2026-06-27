import { Link } from 'react-router-dom'
import { useDelayedFlag } from '../../../lib/useDelayedFlag.js'
import { moduleAccent, ACCENT_HOVER } from '../../../lib/moduleAccent.js'
import { AccentArrow } from '../../../components/ui.jsx'

// Shared frame for every dashboard widget: a titled card that renders one of
// three states — error, loading (no data yet), or its children (the data).
//
// A widget may pass a `skeleton` node shaped like its real body. While the
// first load is in flight that skeleton fills the card (sized to match the real
// content, so swapping data in causes no layout shift). It only fades in after
// a short delay (useDelayedFlag), so a fast load never flashes a placeholder —
// the slot still reserves the height immediately, so the card never collapses.
// Widgets that pass no `skeleton` keep the original plain "loading…" text.
//
// Pass `to` to make the whole card link to that module page. We use a
// stretched-link overlay (an absolutely-positioned <Link> over the card) rather
// than wrapping the card in <Link>, so widgets that have their OWN inner links
// (Containers' per-row ↗, AdGuard's "Open ↗" action) keep working — those inner
// elements just sit above the overlay via `relative z-20`. At rest the card is
// unchanged; on desktop hover it lifts and glows in its module's accent color
// (var(--accent), see lib/moduleAccent.js).
export default function Widget({ title, loading, error, skeleton, action, to, className = '', children }) {
  // The skeleton occupies the card during the first load (when a widget opted in
  // by providing one). We key off `loading` rather than the absence of children:
  // a widget with several child expressions passes `children` as a truthy array
  // even before its data arrives, so `!children` would never fire for it.
  // `loading` is only true until the first response, so this can't linger.
  const skeletonPending = Boolean(skeleton) && loading && !error
  const revealed = useDelayedFlag(skeletonPending)

  let body
  if (error) {
    body = <p className="text-sm text-rose-400">unavailable — {error}</p>
  } else if (skeletonPending) {
    body = (
      <div className={`transition-opacity duration-150 ${revealed ? 'opacity-100' : 'opacity-0'}`}>
        {skeleton}
      </div>
    )
  } else if (children) {
    body = children
  } else {
    body = <p className="text-sm text-slate-400">loading…</p>
  }

  // Desktop-hover treatment for a linkable card (lift + accent glow), shared with
  // the Weather hero via ACCENT_HOVER so the interaction language can't drift.
  // Tailwind v4 gates `hover:` behind `@media (hover: hover)`, so touch screens
  // just navigate on tap with no motion. The accent rides the `--accent` CSS
  // variable (set inline below) because Tailwind can't compile a runtime color
  // into a class — the arbitrary-value utilities read the variable instead.
  const linkClasses = to ? ACCENT_HOVER : ''

  return (
    <section
      className={`relative rounded-xl border border-slate-800 bg-slate-900/50 p-4 ${linkClasses} ${className}`}
      style={to ? { '--accent': moduleAccent(to) } : undefined}
    >
      {to && (
        // Stretched click target covering the whole card. Sits above the static
        // content (z-10) but below any inner links (z-20). The sr-only label is
        // the link's accessible name (visible card text stays out of it).
        <Link
          to={to}
          className="absolute inset-0 z-10 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
        >
          <span className="sr-only">View {title}</span>
        </Link>
      )}
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-300">{title}</h2>
        {/* z-20 so a header action (e.g. AdGuard's "Open ↗") stays clickable
            above the stretched-link overlay. */}
        <div className="relative z-20 flex items-center gap-2">
          {action}
          {/* The "go to page" affordance — hidden when the widget already shows
              its own ↗ action (AdGuard). */}
          {to && !action && <AccentArrow />}
          {loading && <span className="text-xs text-slate-400">…</span>}
        </div>
      </header>
      {body}
    </section>
  )
}
