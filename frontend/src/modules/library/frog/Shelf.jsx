import { useEffect, useRef } from 'react'
import { coverUrl } from '../../../lib/library.js'
import { FROG, systemStyle, reflection } from './theme.js'
import { agoLabel } from './shelf.js'
import { Reflected, SystemFrog } from './Frog.jsx'
import Console from './Console.jsx'

// The shelf: Frog's home screen.
//
// The shape of it is the argument. Every other front-end opens on a wall of box art
// and makes you hunt; this opens on the two things that are actually true of a games
// library you own:
//
//   1. You are almost always coming back to the SAME GAME. → "Jump back in" is rail
//      zero, it's where focus lands, and it means most sessions never touch a letter.
//   2. There are only six machines, and six fits on one screen. → the systems row
//      NEVER SCROLLS. No paging, no carousel, no hidden seventh tile. You can see
//      your whole collection's shape in one look, which is the feeling a shelf of
//      cartridges gives you and a scrolling grid never does.
//
// The frog stands to the side wearing the colours of whatever you're pointing at.
// It is not decoration — it's the focus indicator, at 200px, readable from a couch.

// The float and the focus-pop are TWO ELEMENTS, and they have to be.
//
// A CSS animation's `transform` outranks an inline one — including the style
// attribute — so a `.frog-float` tile with `transform: scale(1.06)` on it renders at
// scale 1: the keyframes win and the pop silently never happens. (It even *worked*
// under prefers-reduced-motion, where the animation is off, which is a fun way to be
// misled.) The wrapper bobs; the child scales.
function Floats({ delay, children }) {
  return (
    <div className="frog-float" style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

function SystemTile({ system, focused, onFocus, onPick }) {
  const s = systemStyle(system.label)
  const empty = system.count === 0

  return (
    <button
      type="button"
      data-testid="frog-system"
      data-focused={focused || undefined}
      onMouseMove={onFocus}
      onClick={onPick}
      disabled={empty}
      className="group relative flex w-full flex-col items-center rounded-2xl px-2 pb-3 pt-4 transition-transform duration-200"
      style={{
        background: focused
          ? `linear-gradient(180deg, rgba(${s.accent}, 0.20), rgba(${s.accent}, 0.05))`
          : FROG.panel,
        border: `1px solid ${focused ? `rgba(${s.accent}, 0.55)` : FROG.line}`,
        boxShadow: focused ? reflection(s.accent, 0.4) : 'none',
        transform: focused ? 'scale(1.06)' : 'scale(1)',
        opacity: empty ? 0.35 : 1,
      }}
    >
      <Console
        system={system.label}
        size={78}
        style={{ filter: focused ? `drop-shadow(0 8px 18px rgba(${s.accent}, 0.45))` : 'none' }}
      />
      {/* Two lines' worth of room whether the name needs it or not, so "Game Boy
          Advance" wrapping doesn't shove its game count out of line with the others. */}
      <span
        className="mt-2 line-clamp-2 flex min-h-[2.5em] items-center text-center text-[13px] font-medium leading-tight"
        style={{ color: focused ? FROG.ink : FROG.soft }}
      >
        {system.label}
      </span>
      <span className="mt-0.5 text-[11px] tabular-nums" style={{ color: FROG.faint }}>
        {empty ? 'empty' : `${system.count} game${system.count === 1 ? '' : 's'}`}
      </span>
    </button>
  )
}

function GameCard({ game, focused, onFocus, onPick }) {
  const s = systemStyle(game.label)

  return (
    <button
      type="button"
      data-testid="frog-jump"
      data-focused={focused || undefined}
      onMouseMove={onFocus}
      onClick={onPick}
      className="relative flex w-36 shrink-0 flex-col overflow-hidden rounded-xl text-left transition-transform duration-200 sm:w-40"
      style={{
        background: FROG.panel,
        border: `1px solid ${focused ? `rgba(${s.accent}, 0.6)` : FROG.line}`,
        boxShadow: focused ? reflection(s.accent, 0.45) : 'none',
        transform: focused ? 'scale(1.05)' : 'scale(1)',
      }}
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden" style={{ background: '#000' }}>
        <img
          src={coverUrl(game.id)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          style={{ opacity: focused ? 1 : 0.72 }}
        />
        {/* The system's colour washes up from the bottom, so a cover you half-recognize
            still tells you which machine it's for before you read anything. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
          style={{ background: `linear-gradient(to top, rgba(${s.accent}, 0.35), transparent)` }}
        />
      </div>
      <div className="px-2.5 py-2">
        <p className="truncate text-[13px] font-medium" style={{ color: focused ? FROG.ink : FROG.soft }}>
          {game.name}
        </p>
        <p className="mt-0.5 truncate text-[11px]" style={{ color: FROG.faint }}>
          {agoLabel(game.ts)}
        </p>
      </div>
    </button>
  )
}

// A rail heading. Small, wide-tracked, quiet — it labels the row without competing
// with it.
function Heading({ children }) {
  return (
    <h2 className="mb-2 px-1 text-[11px] font-semibold tracking-[0.2em]" style={{ color: FROG.faint }}>
      {children.toUpperCase()}
    </h2>
  )
}

export default function Shelf({ rails, focus, onFocus, onPick }) {
  const railRefs = useRef([])

  // Keep the focused tile on screen as the pad/keyboard moves focus. `block: 'nearest'`
  // handles both axes — the horizontal "Jump back in" rail and, on a phone, a systems
  // tile that the vertical scroll has pushed below the fold.
  useEffect(() => {
    const el = railRefs.current[focus.rail]?.children?.[focus.index]
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [focus])

  const system = (() => {
    const rail = rails[focus.rail]
    const item = rail?.items?.[focus.index]
    return item?.label ?? null
  })()
  const s = systemStyle(system)
  const current = rails[focus.rail]?.items?.[focus.index]
  const isGame = rails[focus.rail]?.kind === 'game'

  return (
    <div
      data-testid="frog-shelf"
      // Scrolls vertically when the content is taller than the screen. On a phone in
      // touch mode the frog, "Jump back in" and the systems grid stack into a column
      // that can run past the fold — without this the systems below it are simply
      // unreachable (nothing to scroll to them). On a wide screen it's a centred row
      // that never overflows, so the scroll is inert there.
      className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-4 lg:flex-row lg:items-center"
    >
      {/* The frog. It wears the focused machine's colours and hops when they change
          (the key is the system, so React remounts it and the hop plays once). */}
      <aside className="flex shrink-0 items-center justify-center gap-4 lg:w-60 lg:flex-col lg:justify-center">
        <div className="frog-hop shrink-0" key={system || 'none'}>
          <Reflected scale={0.5}>
            {/* One frog, two sizes — small on a phone, big on a wide screen. The
                show/hide toggle lives on these wrappers, NOT on SystemFrog itself:
                SystemFrog's root is `inline-block`, and that display utility beats a
                `hidden` passed alongside it, so toggling it directly leaves BOTH
                frogs on screen. A plain wrapper has no such fight. */}
            <div className="lg:hidden">
              <SystemFrog size={128} system={system} />
            </div>
            <div className="hidden lg:block">
              <SystemFrog size={210} system={system} />
            </div>
          </Reflected>
        </div>

        {/* The caption belongs TO the frog — it's what the frog is looking at — so it
            sits under it (with room for the reflection), not floating on its own. */}
        <div className="min-w-0 text-center lg:mt-24">
          <p className="truncate text-lg font-semibold" style={{ color: FROG.ink }}>
            {current ? (isGame ? current.name : current.label) : 'Nothing here yet'}
          </p>
          <p className="mt-0.5 truncate text-xs font-medium" style={{ color: `rgb(${s.accent})` }}>
            {isGame ? current?.label : current ? `${current.count} game${current.count === 1 ? '' : 's'}` : ''}
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col justify-start gap-7 lg:justify-center">
        {rails.map((rail, r) => (
          <section key={rail.id}>
            <Heading>{rail.title}</Heading>

            {rail.kind === 'system' ? (
              // Six across, never scrolling — the whole point of the shelf. Two rows
              // of three when the screen is too narrow for six (a phone in portrait),
              // which still shows every machine at once.
              <div
                ref={(el) => (railRefs.current[r] = el)}
                className="grid grid-cols-3 gap-3 sm:grid-cols-6"
              >
                {rail.items.map((sys, i) => (
                  <Floats key={sys.id} delay={i * 220}>
                    <SystemTile
                      system={sys}
                      focused={focus.rail === r && focus.index === i}
                      onFocus={() => onFocus(r, i)}
                      onPick={() => onPick(rail, sys)}
                    />
                  </Floats>
                ))}
              </div>
            ) : (
              <div
                ref={(el) => (railRefs.current[r] = el)}
                className="flex gap-3 overflow-x-auto pb-2"
                style={{ scrollbarWidth: 'none' }}
              >
                {rail.items.map((game, i) => (
                  <Floats key={game.id} delay={i * 260}>
                    <GameCard
                      game={game}
                      focused={focus.rail === r && focus.index === i}
                      onFocus={() => onFocus(r, i)}
                      onPick={() => onPick(rail, game)}
                    />
                  </Floats>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
