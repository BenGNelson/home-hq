import { useDelayedFlag } from '../../../lib/useDelayedFlag.js'

// Shared frame for every dashboard widget: a titled card that renders one of
// three states — error, loading (no data yet), or its children (the data).
//
// A widget may pass a `skeleton` node shaped like its real body. While the
// first load is in flight that skeleton fills the card (sized to match the real
// content, so swapping data in causes no layout shift). It only fades in after
// a short delay (useDelayedFlag), so a fast load never flashes a placeholder —
// the slot still reserves the height immediately, so the card never collapses.
// Widgets that pass no `skeleton` keep the original plain "loading…" text.
export default function Widget({ title, loading, error, skeleton, action, className = '', children }) {
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
    body = <p className="text-sm text-slate-500">loading…</p>
  }

  return (
    <section
      className={`rounded-xl border border-slate-800 bg-slate-900/50 p-4 ${className}`}
    >
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300">{title}</h3>
        <div className="flex items-center gap-2">
          {action}
          {loading && <span className="text-xs text-slate-500">…</span>}
        </div>
      </header>
      {body}
    </section>
  )
}
