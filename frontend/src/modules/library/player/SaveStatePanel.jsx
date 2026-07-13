import { ChevronLeft, Save } from 'lucide-react'
import SaveStateCard from '../SaveStateCard.jsx'
import { Spinner } from '../../../components/ui.jsx'

// The in-game save-state shelf, opened from the pause menu.
//
// Not fixed "slots": the backend timestamps every snapshot, so this is a
// newest-first list you keep adding to — there is no overwrite, you save another
// one and delete the ones you don't want. Loading restores into the RUNNING game
// (no reboot), unlike the old launch-with-?slot path.
export default function SaveStatePanel({ gameId, states, loading, busy, error, onSave, onLoad, onDelete, onBack }) {
  const game = { id: gameId } // SaveStateCard only needs the id, to build its shot URL

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col bg-slate-950/85 backdrop-blur-md"
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

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <button
            onClick={onSave}
            disabled={busy}
            className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-500/60 bg-emerald-500/10 text-emerald-300 active:bg-emerald-500/20 disabled:opacity-50"
          >
            {busy ? <Spinner /> : <Save className="h-6 w-6" aria-hidden="true" />}
            <span className="text-xs font-medium">{busy ? 'Saving…' : 'Save new state'}</span>
          </button>

          {states.map((s) => (
            <SaveStateCard
              key={s.slot}
              game={game}
              state={s}
              actionLabel="Load"
              onSelect={() => onLoad(s.slot)}
              onDelete={() => onDelete(s.slot)}
            />
          ))}
        </div>

        {loading && <p className="py-6 text-center text-sm text-slate-500">loading…</p>}
        {!loading && states.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">
            No saved states yet. Save one here and it’ll show up on your other devices too.
          </p>
        )}
      </div>
    </div>
  )
}
