import { useEffect, useMemo, useRef, useState } from 'react'
import { coverUrl, ALPHABET, letterOf } from '../../../lib/library.js'
import { windowRange, spacers } from '../../../lib/windowRange.js'
import { FROG, systemStyle, reflection } from './theme.js'
import Console from './Console.jsx'
import Frog, { Reflected } from './Frog.jsx'

const ROW = 44

// One system's games.
//
// **A text list, not a grid of covers.** This is the call I'd defend hardest, and
// it's the opposite of what every other front-end does:
//
//   - Retro box art is mostly a small logo on a big flat field. Shrink 496 of them
//     into a grid and you get 496 indistinguishable rectangles — you end up reading
//     the labels anyway, so the art was never doing the finding.
//   - Retro titles are LONG ("Legend of Zelda, The - Oracle of Seasons"). A grid
//     truncates them; a list doesn't.
//   - A list moves at one row per D-pad press with the eye on a fixed spot. A grid
//     makes you scan in two dimensions to move in one.
//
// So the art gets ONE slot, at a size where it's actually worth looking at, next to
// the game you're pointing at. You find by reading and confirm by looking — which is
// how you'd use a shelf of cartridges with the spines facing out.
//
// The letter rail on the right is the fast lane: the triggers jump letter to letter,
// so getting to "Super Mario World" is two flicks and not sixty presses.
export default function GameList({ system, games, focus, onFocus, onPick }) {
  const s = systemStyle(system)
  const current = games[focus] ?? null

  const scrollerRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    setHeight(el.clientHeight)
    const onScroll = () => setScrollTop(el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Keep the focused row in view. `block: 'center'` (not 'nearest') so the eye stays
  // on a fixed spot and the list moves under it — the thing that makes a long list
  // feel navigable rather than crawled.
  useEffect(() => {
    const el = scrollerRef.current?.querySelector('[data-focused]')
    el?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [focus, games])

  // windowRange is 1-D and axis-agnostic; the names read horizontal because Big
  // Picture's rails got there first. 496 rows mounted at once is what made those
  // rails stutter, and a list is no different.
  const { start, end } = windowRange({
    count: games.length,
    scrollLeft: scrollTop,
    viewportWidth: height,
    step: ROW,
    focusIndex: focus,
  })
  const pad = spacers({ count: games.length, start, end, step: ROW })
  const visible = games.slice(start, end + 1)

  // Which letters actually have games behind them. A rail that offers you "Q" when
  // there is no Q is a rail that lies.
  const live = useMemo(() => new Set(games.map((g) => letterOf(g.name))), [games])
  const currentLetter = current ? letterOf(current.name) : null

  return (
    <div data-testid="frog-games" className="flex min-h-0 flex-1 gap-5 px-6 pb-2">
      {/* The one slot where art is worth looking at. */}
      <aside className="hidden w-64 shrink-0 flex-col justify-center gap-4 lg:flex">
        {/* The frog came in from the shelf still wearing this machine's colours, and
            it stays. It's the thread that makes three screens feel like one app. */}
        <div className="flex justify-center pb-8">
          <Reflected scale={0.45}>
            <Frog size={76} system={system} />
          </Reflected>
        </div>

        {current && (
          <>
            <div
              className="frog-float relative overflow-hidden rounded-2xl"
              style={{
                border: `1px solid rgba(${s.accent}, 0.35)`,
                boxShadow: reflection(s.accent, 0.45),
                background: '#000',
              }}
            >
              <img
                key={current.id}
                src={coverUrl(current.id)}
                alt=""
                className="frog-rise aspect-[3/4] w-full object-cover"
              />
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3"
                style={{ background: `linear-gradient(to top, rgba(${s.accent}, 0.4), transparent)` }}
              />
            </div>
            <p className="mt-3 text-sm font-semibold leading-snug" style={{ color: FROG.ink }}>
              {current.name}
            </p>
            <p className="mt-0.5 text-xs" style={{ color: `rgb(${s.accent})` }}>
              {system}
            </p>
          </>
        )}
      </aside>

      {/* The list. */}
      <div ref={scrollerRef} className="min-w-0 flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <div style={{ height: pad.before }} />
        <ul>
          {visible.map((g, i) => {
            const index = start + i
            const on = index === focus
            return (
              <li key={g.id}>
                <button
                  type="button"
                  data-focused={on || undefined}
                  data-testid="frog-row"
                  onMouseMove={() => onFocus(index)}
                  onClick={() => onPick(g)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 text-left transition-colors"
                  style={{
                    height: ROW,
                    background: on ? `rgba(${s.accent}, 0.16)` : 'transparent',
                    boxShadow: on ? `inset 0 0 0 1px rgba(${s.accent}, 0.45)` : 'none',
                  }}
                >
                  {/* The cursor: a lit edge on the focused row, in the machine's colour. */}
                  <span
                    className="h-5 w-[3px] shrink-0 rounded-full"
                    style={{
                      background: on ? `rgb(${s.accent})` : 'transparent',
                      boxShadow: on ? `0 0 12px rgba(${s.accent}, 0.9)` : 'none',
                    }}
                  />
                  <span
                    className="truncate text-[15px]"
                    style={{ color: on ? FROG.ink : FROG.soft, fontWeight: on ? 600 : 400 }}
                  >
                    {g.name}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <div style={{ height: pad.after }} />
      </div>

      {/* The letter rail. Dead letters are dimmed, not hidden — the alphabet keeps
          its shape, so your thumb learns where "S" is and it's there every time. */}
      <nav className="flex w-8 shrink-0 flex-col items-center justify-center gap-px" aria-label="Jump to letter">
        {ALPHABET.map((ch) => {
          const has = live.has(ch)
          const on = ch === currentLetter
          return (
            <button
              key={ch}
              type="button"
              disabled={!has}
              onClick={() => {
                const i = games.findIndex((g) => letterOf(g.name) === ch)
                if (i >= 0) onFocus(i)
              }}
              className="w-full rounded text-[11px] font-semibold leading-[1.5]"
              style={{
                color: on ? FROG.ground : has ? FROG.soft : FROG.faint,
                background: on ? `rgb(${s.accent})` : 'transparent',
                opacity: has ? 1 : 0.3,
              }}
            >
              {ch}
            </button>
          )
        })}
      </nav>
    </div>
  )
}

// The system's header — the console it belongs to, its name, how many.
export function GameListHeader({ system, count }) {
  const s = systemStyle(system)
  return (
    <div className="flex items-center gap-3">
      <Console system={system} size={38} />
      <div>
        <h1 className="text-lg font-semibold leading-none" style={{ color: FROG.ink }}>
          {system}
        </h1>
        <p className="mt-1 text-[11px] tabular-nums" style={{ color: `rgb(${s.accent})` }}>
          {count} game{count === 1 ? '' : 's'}
        </p>
      </div>
    </div>
  )
}
