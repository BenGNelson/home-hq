import { useEffect, useRef } from 'react'
import { ChevronLeft, Save } from 'lucide-react'
import SaveStateCard from '../SaveStateCard.jsx'
import { Spinner } from '../../../components/ui.jsx'
import { moveInGrid } from '../../../lib/gridNav.js'

// The in-game save-state shelf, opened from the pause menu.
//
// Not fixed "slots": the backend timestamps every snapshot, so this is a
// newest-first list you keep adding to — there is no overwrite, you save another
// one and delete the ones you don't want. Loading restores into the RUNNING game
// (no reboot), unlike the old launch-with-?slot path.
//
// CONTROLLER/KEYBOARD NAVIGABLE. The pause menu is D-pad driven, so the shelf it
// opens has to be too — otherwise "load a save" means reaching for the glass in the
// middle of a game, which is the exact reach the pad was meant to end. The grid it
// walks is [Save-new tile, ...states]; the focus index is owned by the player (so the
// gamepad and this component can't disagree), and the column count is MEASURED and
// reported up — the layout is responsive (2/3/4 wide), so a guessed `cols` would send
// up/down to the wrong row on some screen. `focus`/`onFocus`/`onCols` are the wiring.
export default function SaveStatePanel({
  gameId,
  states,
  loading,
  busy,
  error,
  focus = 0,
  onFocus,
  onCols,
  onSave,
  onLoad,
  onDelete,
  onBack,
  legend,
}) {
  const game = { id: gameId } // SaveStateCard only needs the id, to build its shot URL
  const count = states.length + 1 // the Save-new tile, then one cell per state

  const gridRef = useRef(null)
  const colsRef = useRef(2)
  const panelRef = useRef(null)

  // Read the REAL column count off the rendered grid and report it up, so the
  // d-pad's up/down jumps a visual row instead of a hard-coded guess.
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const measure = () => {
      const cols = Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length)
      colsRef.current = cols
      onCols?.(cols)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [onCols])

  // Take the keys the moment the shelf opens, so a desktop player drives it without
  // clicking into it first.
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  // Keep the focused cell on screen when the cursor walks past the fold.
  useEffect(() => {
    panelRef.current?.querySelector('[data-focused="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focus])

  // The one action that both the pad and the keyboard resolve the same way.
  const activate = () => (focus === 0 ? onSave() : onLoad(states[focus - 1]?.slot))

  const onKeyDown = (e) => {
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key]
    if (dir) {
      e.preventDefault()
      onFocus(moveInGrid({ count, cols: colsRef.current, index: focus }, dir, { centerLastRow: true }))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      activate()
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      if (focus > 0) onDelete(states[focus - 1]?.slot)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onBack()
    }
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Save states"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="absolute inset-0 z-30 flex flex-col bg-slate-950/85 outline-none backdrop-blur-md"
      style={{
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded-lg bg-slate-800/80 px-2.5 py-1.5 text-sm text-slate-200 active:bg-slate-700"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back
        </button>
        <h2 className="min-w-0 flex-1 truncate text-center text-sm font-medium text-slate-200">Save states</h2>
        <span className="w-16" aria-hidden="true" />
      </div>

      {error && <p className="px-4 pb-2 text-sm text-rose-400">{error}</p>}

      {/* touch-auto: the player wrapper turns touch-action off so a thumb on the
          d-pad can't drag the page — but that inherits here too, and this list
          has to be scrollable with a finger. */}
      <div className="min-h-0 flex-1 touch-auto overflow-y-auto overscroll-contain px-3 pb-4">
        <div ref={gridRef} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <button
            onClick={onSave}
            onMouseEnter={() => onFocus(0)}
            disabled={busy}
            data-focused={focus === 0 || undefined}
            className={`flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-emerald-500/10 text-emerald-300 transition-transform active:bg-emerald-500/20 disabled:opacity-50 ${
              focus === 0 ? 'scale-105 border-emerald-300 ring-2 ring-emerald-400/60' : 'border-emerald-500/60'
            }`}
          >
            {busy ? <Spinner /> : <Save className="h-6 w-6" aria-hidden="true" />}
            <span className="text-xs font-medium">{busy ? 'Saving…' : 'Save new state'}</span>
          </button>

          {states.map((s, i) => (
            <div key={s.slot} data-focused={focus === i + 1 || undefined} onMouseEnter={() => onFocus(i + 1)}>
              <SaveStateCard
                game={game}
                state={s}
                actionLabel="Load"
                focused={focus === i + 1}
                onSelect={() => onLoad(s.slot)}
                onDelete={() => onDelete(s.slot)}
              />
            </div>
          ))}
        </div>

        {loading && <p className="py-6 text-center text-sm text-slate-500">loading…</p>}
        {!loading && states.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">
            No saved states yet. Save one here and it’ll show up on your other devices too.
          </p>
        )}
      </div>

      {legend && <div className="shrink-0 px-3 pb-3">{legend}</div>}
    </div>
  )
}
