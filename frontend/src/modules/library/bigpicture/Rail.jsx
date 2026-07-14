import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import GameCover from '../GameCover.jsx'
import { sectionAccent } from '../../../lib/library.js'
import { glowFilter } from '../../../lib/glow.js'
import { windowRange, spacers } from '../../../lib/windowRange.js'

const GAMES = sectionAccent('games')

// One tile plus its gap, in pixels. Fixed on purpose: the spacer that stands in for
// the un-rendered tiles has to be exactly as wide as they would have been, or the
// scrollbar lies and scrolling jumps. A responsive tile width would make that
// arithmetic guesswork.
export const TILE = 128
export const GAP = 16
const STEP = TILE + GAP

// One horizontal row of box art.
//
// It renders only the tiles you can see (plus a few either side). Rendering all of
// them mounts 496 <img> elements for Game Boy Color alone, and the browser pays for
// that on every single scroll.
//
// The focused tile scales up and lights up rather than just gaining a border — from
// arm's length, a 2px outline is invisible but a size change is not.
export default function Rail({ title, items, focused, focusIndex, autoScroll, onFocus, onPick }) {
  const scrollerRef = useRef(null)
  const [view, setView] = useState({ scrollLeft: 0, width: 0 })

  // Track the scroll position so the window follows a finger or a mouse wheel too —
  // not just the controller. rAF-coalesced: a scroll event can fire far more often
  // than the screen refreshes, and re-rendering on each one would recreate the stutter
  // we're here to remove.
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    let queued = false
    const measure = () => {
      queued = false
      setView({ scrollLeft: el.scrollLeft, width: el.clientWidth })
    }
    const onScroll = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(measure)
    }
    measure()
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [])

  const { start, end } = windowRange({
    count: items.length,
    scrollLeft: view.scrollLeft,
    viewportWidth: view.width || 1200,
    step: STEP,
    focusIndex: focused ? focusIndex : null,
  })
  const pad = spacers({ count: items.length, start, end, step: STEP })
  const visible = items.slice(start, end + 1)

  return (
    <section className="min-w-0">
      <h2
        className={`mb-2 px-6 text-xs font-semibold uppercase tracking-widest transition-colors ${
          focused ? 'text-violet-300' : 'text-slate-500'
        }`}
      >
        {title}
        <span className="ml-2 font-normal normal-case tracking-normal text-slate-600">{items.length}</span>
      </h2>

      <div
        ref={scrollerRef}
        className="flex overflow-x-auto px-6 pb-3 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ gap: GAP, contain: 'layout paint' }}
      >
        {/* Stand-ins for the tiles that aren't rendered, so the rail is as long as it
            ought to be and the scroll position stays honest. */}
        {pad.before > 0 && <div style={{ width: pad.before - GAP, flex: 'none' }} aria-hidden="true" />}

        {visible.map((game, i) => {
          const index = start + i
          return (
            <Tile
              key={game.id}
              game={game}
              active={focused && index === focusIndex}
              autoScroll={autoScroll}
              onFocus={() => onFocus(index)}
              onPick={() => onPick(game)}
            />
          )
        })}

        {pad.after > 0 && <div style={{ width: pad.after, flex: 'none' }} aria-hidden="true" />}
      </div>
    </section>
  )
}

function Tile({ game, active, autoScroll, onFocus, onPick }) {
  const ref = useRef(null)

  // Keep the focused tile on screen, with room either side — a tile pinned flush to
  // the edge reads as "the end of the list" even when it isn't.
  //
  // NOT when the pointer moved focus here: scrolling the rail under a stationary
  // cursor slides a different tile beneath it, which focuses THAT one, which scrolls
  // again — the rail chases the mouse forever.
  useEffect(() => {
    if (active && autoScroll) {
      ref.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
    }
  }, [active, autoScroll])

  return (
    <button
      ref={ref}
      onMouseMove={onFocus}
      onClick={onPick}
      aria-current={active || undefined}
      style={{ width: TILE, flex: 'none' }}
      className={`rounded-lg transition-transform duration-150 ${
        active ? 'scale-[1.08]' : 'scale-100 opacity-70'
      }`}
    >
      <GameCover
        game={game}
        className={`w-full rounded-lg ring-2 ${active ? 'ring-violet-400' : 'ring-transparent'}`}
        style={active ? { filter: glowFilter(GAMES.rgb, 0.8) } : undefined}
      />
      <p className={`mt-1.5 truncate text-left text-[11px] ${active ? 'text-slate-100' : 'text-slate-500'}`}>
        {game.name}
      </p>
    </button>
  )
}
