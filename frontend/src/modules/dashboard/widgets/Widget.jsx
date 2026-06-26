import { useDelayedFlag } from '../../../lib/useDelayedFlag.js'
import { backlitSurface, backlitDot } from '../../../lib/glow.js'

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
// `accent` (an "r,g,b" string) opts a card into the "back-lit radiance" motif:
// a radiant backdrop + tinted border + a glowing status dot by the title, tinted
// to that color. Reserved for cards where the color MEANS something (e.g. System
// health) — see docs/ARCHITECTURE.md → "Visual motif: back-lit radiance".
export default function Widget({ title, loading, error, skeleton, action, accent, className = '', children }) {
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

  // Only back-light once data has resolved (accent is known) and the card isn't
  // erroring — a glowing error card would misread.
  const lit = Boolean(accent) && !error

  return (
    <section
      className={`rounded-xl border p-4 ${lit ? '' : 'border-slate-800 bg-slate-900/50'} ${className}`}
      style={lit ? backlitSurface(accent) : undefined}
    >
      <header className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium text-slate-300">
          {lit && (
            <span className="h-2 w-2 shrink-0 rounded-full" aria-hidden="true" style={backlitDot(accent)} />
          )}
          {title}
        </h2>
        <div className="flex items-center gap-2">
          {action}
          {loading && <span className="text-xs text-slate-400">…</span>}
        </div>
      </header>
      {body}
    </section>
  )
}
