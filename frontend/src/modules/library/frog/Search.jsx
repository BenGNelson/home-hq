import { useEffect, useMemo, useRef } from 'react'
import { coverUrl } from '../../../lib/library.js'
import { FROG, systemStyle, reflection } from './theme.js'
import { KEYS, COLS, liveKeys } from './search.js'
import Frog, { Reflected } from './Frog.jsx'

// The search screen.
//
// A controller keyboard, done the way a couch deserves: a 6×6 grid of keys, a query
// you build one press at a time, and — the part that makes it bearable — every key
// that would lead to an empty list is DIMMED before you press it. You feel your way
// to a game by which doors are still open, not by typing and backspacing.
//
// Presentational only. FrogBrowser owns the query, the focus, and which zone (the
// grid or the results) has the cursor; this draws what it's told. That's the same
// contract the shelf and the game list keep, and it's what will let the whole folder
// lift into its own repo as a copy rather than a rewrite.
export default function Search({ query, results, zone, keyIndex, resultRow, allGames, native, onKey, onResult, onPick, onType }) {
  // Which keys still lead somewhere. Derived from the WHOLE library (not the capped
  // result list), so dimming is honest even when there are more matches than we show.
  const live = useMemo(() => liveKeys(allGames, query), [allGames, query])

  // Dimming is a DISCRIMINATOR: it earns its keep only when it can tell keys apart —
  // some lead somewhere, some don't. So it fires whenever the live set is a proper
  // subset of the board, which covers both the useful cases:
  //   - empty query: dim the letters no title contains at all (a lit key always types)
  //   - mid-word: dim the dead ends
  // ...and stays quiet in the one useless case — a finished word ("mario"), where the
  // only continuations are spaces, so live.size is 0 and a fully-greyed board would
  // just look broken. Lit-but-inert then is intentional: it means "go look down".
  const discriminates = live.size > 0 && live.size < KEYS.length

  // The game whose art we show: the one you're pointing at in the results, or — while
  // you're still typing — the top hit, as a preview of where this query is heading.
  const preview = zone === 'results' ? results[resultRow] : results[0]

  // Keep the focused result in view when the cursor walks the list.
  const listRef = useRef(null)
  useEffect(() => {
    if (zone !== 'results') return
    listRef.current?.querySelector('[data-focused]')?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [zone, resultRow])

  return (
    <div data-testid="frog-search" className="flex min-h-0 flex-1 flex-col gap-4 px-6 pb-2">
      {/* Top: the keyboard, and the art of wherever the query is pointing. */}
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          {native ? (
            // Touch: the device's own keyboard. A finger doesn't want to walk a 6×6
            // grid one dead key at a time — it wants the keyboard it uses everywhere
            // else. autoFocus raises it as the screen opens; results tap to play.
            <input
              data-testid="frog-search-input"
              autoFocus
              value={query}
              onChange={(e) => onType(e.target.value)}
              placeholder="Type to search"
              type="text"
              inputMode="search"
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Search games"
              className="h-12 w-full rounded-xl px-4 text-lg font-semibold tracking-wide outline-none"
              style={{
                background: FROG.panel,
                border: `1px solid rgba(${FROG.jade}, 0.5)`,
                color: FROG.ink,
                boxShadow: `0 0 18px rgba(${FROG.jade}, 0.15)`,
              }}
            />
          ) : (
            <>
              {/* The field. A caret that pulses so an empty query still looks alive. */}
              <div
                className="mb-3 flex h-11 items-center gap-1 rounded-xl px-4"
                style={{ background: FROG.panel, border: `1px solid ${FROG.line}` }}
              >
                <span className="text-lg font-semibold tracking-wide" style={{ color: query ? FROG.ink : FROG.faint }}>
                  {query || 'Type to search'}
                </span>
                <span
                  className="frog-invite ml-0.5 inline-block h-5 w-0.5"
                  style={{ background: `rgb(${FROG.jade})` }}
                  aria-hidden="true"
                />
              </div>

              {/* The 6×6 grid. */}
              <div
                className="grid gap-1.5"
                style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, maxWidth: 520 }}
                role="group"
                aria-label="On-screen keyboard"
              >
                {KEYS.map((ch, i) => {
                  const on = zone === 'grid' && i === keyIndex
                  const dead = discriminates && !live.has(ch) // a key that leads nowhere
                  return (
                    <button
                      key={ch}
                      type="button"
                      onMouseMove={() => onKey(i)}
                      onClick={() => onPick(null, ch)}
                      className="flex aspect-square items-center justify-center rounded-lg text-lg font-semibold transition-colors"
                      style={{
                        background: on ? `rgb(${FROG.jade})` : FROG.panel,
                        color: on ? FROG.ground : dead ? FROG.faint : FROG.soft,
                        opacity: dead ? 0.35 : 1,
                        boxShadow: on ? `0 0 18px rgba(${FROG.jade}, 0.6)` : 'none',
                      }}
                    >
                      {ch}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* The preview art — and the frog, still on the pond, tying this screen to
            the other two. Hidden on narrow screens where the grid needs the room. */}
        <aside className="hidden w-56 shrink-0 flex-col items-center gap-3 lg:flex">
          <Reflected scale={0.4}>
            <Frog size={64} />
          </Reflected>
          {preview ? (
            <PreviewCard game={preview} />
          ) : (
            <p className="px-2 text-center text-xs leading-relaxed" style={{ color: FROG.faint }}>
              {query ? 'No games match yet' : 'Every game, every system — start typing'}
            </p>
          )}
        </aside>
      </div>

      {/* The results. Empty until you type; then it narrows with every key. */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {results.length === 0 ? (
          <p className="pt-6 text-center text-sm" style={{ color: FROG.faint }}>
            {query ? `Nothing matches “${query}”` : 'Results appear here as you type'}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {results.map((g, i) => {
              const on = zone === 'results' && i === resultRow
              const s = systemStyle(g.label)
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    data-focused={on || undefined}
                    data-testid="frog-search-row"
                    onMouseMove={() => onResult(i)}
                    onClick={() => onPick(g)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors"
                    style={{
                      background: on ? `rgba(${s.accent}, 0.16)` : 'transparent',
                      boxShadow: on ? `inset 0 0 0 1px rgba(${s.accent}, 0.45)` : 'none',
                    }}
                  >
                    <span
                      className="h-4 w-[3px] shrink-0 rounded-full"
                      style={{
                        background: on ? `rgb(${s.accent})` : 'transparent',
                        boxShadow: on ? `0 0 12px rgba(${s.accent}, 0.9)` : 'none',
                      }}
                    />
                    <span
                      className="min-w-0 flex-1 truncate text-[15px]"
                      style={{ color: on ? FROG.ink : FROG.soft, fontWeight: on ? 600 : 400 }}
                    >
                      {g.name}
                    </span>
                    {/* The system chip — results span every console, so each row has
                        to say which one it is, or "Mario" is a coin toss. */}
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide"
                      style={{ color: `rgb(${s.accent})`, background: `rgba(${s.accent}, 0.14)` }}
                    >
                      {g.label}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// The floating box art beside the grid — the one place in search where a cover is
// worth its pixels, because it confirms the single game you're aiming at.
function PreviewCard({ game }) {
  const s = systemStyle(game.label)
  return (
    <div className="w-40">
      <div
        className="frog-float relative overflow-hidden rounded-2xl"
        style={{ border: `1px solid rgba(${s.accent}, 0.35)`, boxShadow: reflection(s.accent, 0.45), background: '#000' }}
      >
        <img key={game.id} src={coverUrl(game.id)} alt="" className="frog-rise aspect-[3/4] w-full object-cover" />
      </div>
      <p className="mt-2 truncate text-sm font-semibold" style={{ color: FROG.ink }}>
        {game.name}
      </p>
      <p className="text-xs" style={{ color: `rgb(${s.accent})` }}>
        {game.label}
      </p>
    </div>
  )
}
