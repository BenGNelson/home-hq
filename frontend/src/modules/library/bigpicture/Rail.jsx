import { useEffect, useRef } from 'react'
import GameCover from '../GameCover.jsx'
import { sectionAccent } from '../../../lib/library.js'
import { glowFilter } from '../../../lib/glow.js'

const GAMES = sectionAccent('games')

// One horizontal row of box art.
//
// The focused tile scales up and lights up rather than just gaining a border —
// from arm's length on a couch, a 2px outline is invisible but a size change is
// not. The row reserves the scale headroom in its padding so a growing tile never
// reflows its neighbours.
export default function Rail({ title, items, focused, focusIndex, autoScroll, onFocus, onPick }) {
  return (
    <section className="min-w-0">
      <h2
        className={`mb-2 px-6 text-xs font-semibold uppercase tracking-widest transition-colors ${
          focused ? 'text-violet-300' : 'text-slate-500'
        }`}
      >
        {title}
      </h2>
      <div className="flex gap-4 overflow-x-auto px-6 pb-3 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((game, i) => (
          <Tile
            key={game.id}
            game={game}
            active={focused && i === focusIndex}
            autoScroll={autoScroll}
            onFocus={() => onFocus(i)}
            onPick={() => onPick(game)}
          />
        ))}
      </div>
    </section>
  )
}

function Tile({ game, active, autoScroll, onFocus, onPick }) {
  const ref = useRef(null)

  // Keep the focused tile on screen, with room either side — a tile pinned flush
  // to the edge of the viewport reads as "the end of the list" even when it isn't.
  //
  // NOT when the pointer moved focus here (autoScroll=false). Scrolling the rail
  // under a stationary cursor slides a different tile beneath it, which focuses
  // THAT one, which scrolls again — the rail chases the mouse forever.
  useEffect(() => {
    if (active && autoScroll) {
      ref.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
    }
  }, [active, autoScroll])

  return (
    <button
      ref={ref}
      // mousemove, not mouseenter: mouseenter also fires when content scrolls
      // beneath a cursor that never moved, which is exactly the loop above.
      onMouseMove={onFocus}
      onClick={onPick}
      aria-current={active || undefined}
      className={`w-28 shrink-0 rounded-lg transition-transform duration-150 sm:w-32 ${
        active ? 'scale-[1.08]' : 'scale-100 opacity-70'
      }`}
      style={active ? { filter: glowFilter(GAMES.rgb, 0.8) } : undefined}
    >
      <GameCover
        game={game}
        className={`w-full rounded-lg ring-2 ${active ? 'ring-violet-400' : 'ring-transparent'}`}
      />
      <p
        className={`mt-1.5 truncate text-left text-[11px] ${active ? 'text-slate-100' : 'text-slate-500'}`}
      >
        {game.name}
      </p>
    </button>
  )
}
