import { useEffect, useRef } from 'react'
import { Play, Save, FolderOpen, FastForward, Maximize, RotateCcw, LogOut } from 'lucide-react'
import { moveInGrid } from '../../../lib/gridNav.js'
import { sectionAccent } from '../../../lib/library.js'
import { radiantBackdrop, glowFilter } from '../../../lib/glow.js'

const GAMES = sectionAccent('games') // violet — the Games role tint

// The in-game menu. Replaces EmulatorJS's own bottom bar, which is a strip of
// small mouse-sized icons that a D-pad can't reach.
//
// A grid of big tiles, not a list: it's reachable by thumb on a phone and by
// D-pad on a controller, and the game keeps rendering (blurred) behind it so you
// never lose your place. Focus is index-based (see lib/gridNav.js) rather than
// DOM-measured, which is what lets the controller drive it.
export const PAUSE_COLS = 3

// The menu's contents, exported so the controller can walk the same grid the
// touch/keyboard user sees — one source of truth for what's on screen and what
// index each thing sits at.
export function pauseItems(fastForward) {
  return [
    { id: 'resume', label: 'Resume', Icon: Play, primary: true },
    { id: 'save', label: 'Save State', Icon: Save },
    { id: 'load', label: 'Load State', Icon: FolderOpen },
    {
      id: 'fastForward',
      label: fastForward ? 'Normal Speed' : 'Fast Forward',
      Icon: FastForward,
      active: fastForward,
    },
    // The top bar (which used to carry this) is hidden while you play, so the
    // menu is where Fullscreen lives now.
    { id: 'fullscreen', label: 'Fullscreen', Icon: Maximize },
    { id: 'restart', label: 'Restart', Icon: RotateCcw },
    { id: 'quit', label: 'Quit', Icon: LogOut, danger: true },
  ]
}

export default function PauseMenu({ open, name, fastForward, focus, onFocus, onAction, legend }) {
  const items = pauseItems(fastForward)

  // Keyboard parity with the controller — the same grid walk drives both, so
  // desktop and pad can never diverge.
  const onKeyDown = (e) => {
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key]
    if (dir) {
      e.preventDefault()
      onFocus(moveInGrid({ count: items.length, cols: PAUSE_COLS, index: focus }, dir))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onAction(items[focus].id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onAction('resume')
    }
  }

  const panelRef = useRef(null)
  useEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Game menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/70 outline-none backdrop-blur-md"
      style={{
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: radiantBackdrop(GAMES.rgb, 0.14) }}
      />

      <div className="relative w-full max-w-lg px-4">
        <p className="mb-1 text-center text-xs font-medium uppercase tracking-widest text-slate-500">Paused</p>
        <h2 className="mb-5 truncate text-center text-lg font-semibold text-slate-100">{name}</h2>

        <div className="grid grid-cols-3 gap-3">
          {items.map((item, i) => (
            <MenuTile
              key={item.id}
              item={item}
              focused={i === focus}
              onSelect={() => onAction(item.id)}
              onHover={() => onFocus(i)}
            />
          ))}
        </div>

        {legend && <div className="mt-5">{legend}</div>}
      </div>
    </div>
  )
}

function MenuTile({ item, focused, onSelect, onHover }) {
  const { Icon, label, primary, danger, active } = item
  const ref = useRef(null)

  // Keep the focused tile on screen when the D-pad walks off the visible area.
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focused])

  const tint = danger ? 'text-rose-300' : primary ? 'text-emerald-300' : active ? 'text-violet-300' : 'text-slate-300'

  return (
    <button
      ref={ref}
      onClick={onSelect}
      onMouseEnter={onHover}
      aria-current={focused || undefined}
      className={`flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border bg-slate-900/70 px-2 transition-all active:scale-[0.97] ${
        focused
          ? 'scale-105 border-violet-400 bg-slate-800/80 ring-2 ring-violet-400/60'
          : 'border-slate-700/80 hover:border-slate-600'
      }`}
      style={focused ? { filter: glowFilter(GAMES.rgb, 0.55) } : undefined}
    >
      <Icon className={`h-7 w-7 ${tint}`} aria-hidden="true" />
      <span className={`text-center text-xs font-medium leading-tight ${focused ? 'text-slate-100' : 'text-slate-400'}`}>
        {label}
      </span>
    </button>
  )
}
