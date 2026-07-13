import { useState } from 'react'
import { saveStateShotUrl } from '../../lib/library.js'
import { formatAgo } from '../../lib/format.js'

// One save state: its screenshot, when it was taken, and what you can do with it.
// Shared by the game's detail page and the in-game pause menu, so a state looks
// the same wherever you meet it.
//
// `actionLabel` differs by context: from the detail page you Resume (boot the
// game into it), from the pause menu you Load (restore it into the game you're
// already playing, with no reboot).
export default function SaveStateCard({ game, state, onSelect, onDelete, actionLabel = 'Resume', focused = false }) {
  const [failed, setFailed] = useState(false)
  return (
    <div
      className={`overflow-hidden rounded-xl border bg-slate-900/60 transition-transform ${
        focused ? 'scale-105 border-violet-400 ring-2 ring-violet-400/60' : 'border-slate-700'
      }`}
    >
      <button onClick={onSelect} className="block w-full text-left">
        <div className="aspect-video w-full bg-black">
          {state.has_shot && !failed ? (
            <img
              src={saveStateShotUrl(game.id, state.slot)}
              alt=""
              loading="lazy"
              onError={() => setFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-slate-600">
              no preview
            </div>
          )}
        </div>
        <div className="px-2 py-1 text-xs text-slate-300">saved {formatAgo(state.created_ms / 1000)}</div>
      </button>
      <div className="flex border-t border-slate-800 text-xs">
        <button onClick={onSelect} className="flex-1 py-1.5 text-sky-400 active:bg-slate-800">
          {actionLabel}
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            className="border-l border-slate-800 px-3 py-1.5 text-rose-400 active:bg-slate-800"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
