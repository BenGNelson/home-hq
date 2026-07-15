import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { useApi } from '../../../lib/useApi.js'
import { systemGames, gameDetailHref } from '../../../lib/library.js'
import { getRecent, recordPlayed } from '../../../lib/recentGames.js'
import { moveInRails } from '../../../lib/gridNav.js'
import { useGamepad } from '../../../lib/useGamepad.js'
import { SkeletonLine } from '../../../components/ui.jsx'
import ButtonLegend from '../player/ButtonLegend.jsx'
import { FROG, systemStyle } from './theme.js'
import { buildShelf, stepLetter } from './shelf.js'
import { searchGames, matches, KEYS, gridMove } from './search.js'
import { FrogMark } from './Frog.jsx'
import Boot from './Boot.jsx'
import Shelf from './Shelf.jsx'
import Search from './Search.jsx'
import GameList, { GameListHeader } from './GameList.jsx'
import './frog.css'

// FROG — the games browser.
//
// One screen at a time, one thing in focus, everything reachable from a D-pad
// without ever touching the glass. It's a front-end for a couch and a controller,
// which is a genuinely different product from the Games pages in Home HQ (built for
// a thumb, on a phone, standing up) — so it is a different app, not a wider layout.
//
// It owns the navigation for the whole browser; the screens under it are drawn from
// props and hold no state of their own. That's what lets the controller, the arrow
// keys and a mouse all drive the same code with none of them a special case, and
// it's what will make lifting this folder into its own repo a copy rather than a
// rewrite.
// The actions that move the shelf. 'search' is handled before we ever get here (it
// opens a whole screen); everything else — the triggers, a stray button — is inert,
// and inert must mean inert, not "quietly re-render into an identical focus object".
const MOVES = new Set(['up', 'down', 'left', 'right', 'railPrev', 'railNext'])

// Frog's place, held for the life of the tab rather than the life of the component.
//
// This has to live outside React. FrogBrowser UNMOUNTS every time you launch a game
// (the player is a different route), so with `useState` alone, quitting a game would
// replay the whole boot animation, ask you to PRESS A again, and dump you back on
// rail zero — having forgotten which system you were three hundred games into. The
// boot is once per app open; your place survives a session.
const place = { booted: false, screen: 'shelf', system: null, focus: { rail: 0, index: 0 }, row: 0 }

export default function FrogBrowser() {
  const navigate = useNavigate()
  const { data, loading } = useApi('/library/games', 0)
  const items = data?.items ?? []

  // 'boot' → 'shelf' ⇄ 'games'.
  const [screen, setScreen] = useState(place.booted ? place.screen : 'boot')
  const [system, setSystem] = useState(place.system)

  const [focus, setFocus] = useState(place.focus)
  const [memory, setMemory] = useState({})
  const [row, setRow] = useState(place.row) // focus within a system's game list

  // Search is transient — a fresh keyboard every time you open it, never restored.
  // `query` is the string you're building; `zone` is which half of the screen has the
  // cursor (the keyboard grid or the results); `from` is where to land when you close.
  const [query, setQuery] = useState('')
  const [zone, setZone] = useState('grid')
  const [keyIndex, setKeyIndex] = useState(0)
  const [resultRow, setResultRow] = useState(0)
  const [searchFrom, setSearchFrom] = useState('shelf')

  const rails = useMemo(() => buildShelf(items, getRecent()), [items])
  const games = useMemo(() => (system ? systemGames(items, system) : []), [items, system])
  // Searched across EVERY system, not just the open one — from the shelf you haven't
  // picked a console yet, and "which box is Zelda in" is exactly what search is for.
  const results = useMemo(() => searchGames(items, query), [items, query])

  useEffect(() => {
    if (screen === 'boot') return
    // Never persist 'search' as the screen: it's a transient overlay with no saved
    // query, so restoring it after a game launch would drop you on an empty keyboard.
    // Persist the screen it was opened over instead.
    Object.assign(place, { booted: true, screen: screen === 'search' ? searchFrom : screen, system, focus, row })
  })

  // Typing narrows the list under the cursor: keep the result focus in range, and if
  // the list empties out from under the results zone, hand the cursor back to the keys.
  useEffect(() => {
    setResultRow((i) => Math.min(i, Math.max(0, results.length - 1)))
    if (!results.length) setZone((z) => (z === 'results' ? 'grid' : z))
  }, [results])

  // Reconcile focus with whatever the rails just became.
  //
  // The rails are rebuilt when the library resolves, and they CHANGE SHAPE when they
  // do: "Jump back in" appears, so what was rail 0 (systems) becomes rail 1. Dismiss
  // the boot before the fetch lands, press right a few times, and focus is left
  // pointing at index 5 of a two-item rail — nothing is highlighted, the frog wears
  // no costume, the caption reads "Nothing here yet", and A does nothing at all.
  useEffect(() => {
    setFocus((f) => {
      const rail = Math.min(f.rail, Math.max(0, rails.length - 1))
      const count = rails[rail]?.items?.length ?? 0
      const index = Math.min(f.index, Math.max(0, count - 1))
      return rail === f.rail && index === f.index ? f : { rail, index }
    })
  }, [rails])

  // Same for the game list: a system with 25 games can't hold a cursor at row 300.
  useEffect(() => {
    setRow((i) => Math.min(i, Math.max(0, games.length - 1)))
  }, [games])

  const play = useCallback(
    (game) => {
      if (!game) return
      recordPlayed(game)
      const q = `id=${encodeURIComponent(game.id)}&core=${encodeURIComponent(game.core)}&name=${encodeURIComponent(
        game.name || ''
      )}&label=${encodeURIComponent(game.label || '')}`
      // No `?slot=`: jumping back in means the game's own in-game save, not an older
      // snapshot. Restoring a save state here would roll the battery save back to
      // whenever that snapshot was taken — the exact way you lose an afternoon.
      navigate(`/library/play?${q}`)
    },
    [navigate]
  )

  const openSystem = useCallback((label) => {
    setSystem(label)
    setRow(0)
    setScreen('games')
  }, [])

  const openSearch = useCallback(() => {
    // openSearch only ever fires from a non-search screen (the toggle calls closeSearch
    // otherwise), so the screen we're leaving IS where to return to.
    setSearchFrom(screen)
    setQuery('')
    setKeyIndex(0)
    setResultRow(0)
    setZone('grid')
    setScreen('search')
  }, [screen])

  const closeSearch = useCallback(() => setScreen(searchFrom), [searchFrom])

  // Append a key, but only if it keeps the list alive — the same dead-key rule the
  // grid dims by, enforced here so you physically cannot type into an empty result
  // set (whether by pad or by a laptop keyboard). Functional update so a fast typist
  // never races a stale `query`.
  const typeKey = useCallback(
    (ch) => {
      setQuery((q) => (items.some((g) => matches(g.name, q + ch)) ? q + ch : q))
      setZone('grid')
    },
    [items]
  )

  // Everything the controller can do, in one place, keyed by which screen is up.
  // Held in a ref so the poll loop is installed once and never re-installed mid-press.
  const act = useRef(() => {})
  act.current = (action) => {
    if (screen === 'boot') return
    // Nothing to point at yet. Without this, presses land against the skeleton's
    // placeholder rails and strand focus the moment the real ones arrive.
    if (loading && !items.length) return

    // X is search from anywhere, and X again closes it — a toggle you can find with
    // one thumb without reading the legend.
    if (action === 'search') {
      screen === 'search' ? closeSearch() : openSearch()
      return
    }

    if (screen === 'search') {
      if (zone === 'grid') {
        switch (action) {
          case 'confirm':
            typeKey(KEYS[keyIndex])
            return
          // B peels back one layer at a time: a typed character, then (empty) out of
          // search entirely. Never a dead end.
          case 'back':
            query ? setQuery((q) => q.slice(0, -1)) : closeSearch()
            return
          // The shoulder is the express lane to the results — one press, from any key,
          // instead of walking Down through every row. The spatial Down-exit below
          // still works for the thumb that expects it.
          case 'railNext':
            if (results.length) {
              setZone('results')
              setResultRow(0)
            }
            return
          case 'up':
          case 'down':
          case 'left':
          case 'right': {
            const move = gridMove(keyIndex, action)
            if (move.exit === 'results') {
              // Down off the bottom row drops into the results — but only if there are
              // any; otherwise the keyboard keeps the cursor rather than stranding it.
              if (results.length) {
                setZone('results')
                setResultRow(0)
              }
            } else {
              setKeyIndex(move.index)
            }
            return
          }
          default:
        }
        return
      }

      // The results zone.
      switch (action) {
        case 'confirm':
          play(results[resultRow])
          return
        case 'alt':
          if (results[resultRow]) navigate(gameDetailHref(results[resultRow].id, '/frog'))
          return
        // Up off the top row hands the cursor back to the keyboard — the mirror of the
        // down-press that brought you here. Decide the zone OUTSIDE the setState updater
        // so the updater stays pure (StrictMode double-invokes it).
        case 'up':
        case 'left':
          if (resultRow <= 0) setZone('grid')
          else setResultRow((i) => i - 1)
          return
        case 'down':
        case 'right':
          setResultRow((i) => Math.min(results.length - 1, i + 1))
          return
        // The shoulder that took you here takes you back.
        case 'railPrev':
        case 'back':
          setZone('grid')
          return
        default:
      }
      return
    }

    if (screen === 'shelf') {
      switch (action) {
        case 'confirm': {
          const rail = rails[focus.rail]
          const item = rail?.items?.[focus.index]
          if (!item) return
          if (rail.kind === 'system') {
            if (item.count > 0) openSystem(item.label)
          } else play(item)
          return
        }
        case 'back':
          navigate('/library/games')
          return
        case 'alt': {
          const rail = rails[focus.rail]
          const item = rail?.items?.[focus.index]
          if (rail?.kind === 'game' && item) navigate(gameDetailHref(item.id, '/frog'))
          return
        }
        default: {
          // Only the directions move the shelf. Falling through to moveInRails with
          // (say) 'search' returns a fresh focus object that's identical but not the
          // same reference — which re-renders and fires a redundant smooth scroll on
          // every press of a button that's supposed to do nothing here.
          if (!MOVES.has(action)) return
          const next = moveInRails(rails, focus, action, memory)
          setMemory(next.memory)
          setFocus(next.focus)
        }
      }
      return
    }

    // The games list.
    const last = games.length - 1
    const clamp = (i) => Math.max(0, Math.min(last, i))
    switch (action) {
      case 'confirm':
        play(games[row])
        return
      case 'back':
        setScreen('shelf')
        return
      case 'alt':
        if (games[row]) navigate(gameDetailHref(games[row].id, '/frog'))
        return
      case 'up':
      case 'left':
        setRow((i) => clamp(i - 1))
        return
      case 'down':
      case 'right':
        setRow((i) => clamp(i + 1))
        return
      // The shoulders skip a screenful; the triggers skip a letter. Sixty presses to
      // reach the S's is what makes a big library feel like a punishment.
      case 'railPrev':
        setRow((i) => clamp(i - 10))
        return
      case 'railNext':
        setRow((i) => clamp(i + 10))
        return
      case 'jumpPrev':
      case 'jumpNext':
        setRow((i) => stepLetter(games, i, action === 'jumpNext' ? 1 : -1))
        return
      default:
    }
  }

  useGamepad({
    onAction: (a) => act.current(a),
    // Any button on a sleeping pad is how we learn a controller exists at all — iOS
    // never fires `gamepadconnected` until then. On the boot screen that press is
    // also the "press A" that dismisses it.
    onPadButton: () => setScreen((s) => (s === 'boot' ? 'shelf' : s)),
    onMenuAction: (a) => {
      if (a === 'start') act.current('confirm')
    },
  })

  // Keyboard parity, so a desktop drives it identically. Frog is a controller app,
  // but "I'm at my laptop and I want to check something" must not require a pad.
  // Held in a ref because the listener is installed once — reading `screen`/`typeKey`
  // straight from the closure would freeze them at their first-render values.
  // A physical Backspace should always EDIT the query — delete a character, or close
  // search when there's nothing left — never just hop between zones the way pad-B does.
  const del = () => {
    if (query) {
      setQuery((q) => q.slice(0, -1))
      setZone('grid')
    } else {
      closeSearch()
    }
  }
  const kbd = useRef({})
  kbd.current = { screen, typeKey, del }
  useEffect(() => {
    const onKey = (e) => {
      // On the search screen a real keyboard should just... type, bypassing the grid.
      if (kbd.current.screen === 'search') {
        if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) {
          e.preventDefault()
          kbd.current.typeKey(e.key.toUpperCase())
          return
        }
        if (e.key === 'Backspace') {
          e.preventDefault()
          kbd.current.del()
          return
        }
      }
      const map = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        Enter: 'confirm',
        Escape: 'back',
        PageUp: 'railPrev',
        PageDown: 'railNext',
        '/': 'search',
      }
      const a = map[e.key]
      if (!a) return
      e.preventDefault()
      act.current(a)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (screen === 'boot') return <Boot onDone={() => setScreen('shelf')} />

  // What the pond light is coloured by: the open system, the result you're pointing
  // at while searching (jade until you've pointed at one), or the shelf's focus.
  const focusedSystem =
    screen === 'games'
      ? system
      : screen === 'search'
        ? zone === 'results' && results[resultRow]
          ? results[resultRow].label
          : null
        : hovered(rails, focus)
  const accent = systemStyle(focusedSystem).accent

  return (
    <div
      data-testid="frog"
      className="fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{
        background: FROG.ground,
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      {/* The pond light. It takes the colour of whatever is in focus, which is the
          single cheapest way to make a machine feel *selected* rather than outlined. */}
      <div
        className="pointer-events-none absolute inset-0 transition-[background] duration-500"
        style={{ background: `radial-gradient(120% 80% at 50% 100%, rgba(${accent}, 0.14), transparent 70%)` }}
      />

      <header className="relative flex items-center justify-between gap-4 px-6 py-3">
        {screen === 'games' && system ? (
          <GameListHeader system={system} count={games.length} />
        ) : (
          <div className="flex items-center gap-2">
            <FrogMark size={22} style={{ color: `rgb(${FROG.jade})` }} />
            <span className="text-sm font-semibold tracking-[0.22em]" style={{ color: FROG.ink }}>
              {screen === 'search' ? 'FROG · SEARCH' : 'FROG'}
            </span>
          </div>
        )}

        <button
          onClick={() => {
            if (screen === 'search') closeSearch()
            else if (screen === 'games') setScreen('shelf')
            else navigate('/library/games')
          }}
          className="shrink-0 rounded-full p-2"
          style={{ background: FROG.panel, color: FROG.soft }}
          aria-label={screen === 'search' ? 'Close search' : screen === 'games' ? 'Back to the shelf' : 'Leave Frog'}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      {loading && !items.length ? (
        <div className="flex-1 space-y-4 px-6 pt-6">
          <SkeletonLine className="h-4 w-40" />
          <div className="flex gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-32 flex-1 rounded-2xl" style={{ background: FROG.panel }} />
            ))}
          </div>
        </div>
      ) : screen === 'search' ? (
        <Search
          query={query}
          results={results}
          allGames={items}
          zone={zone}
          keyIndex={keyIndex}
          resultRow={resultRow}
          onKey={(i) => {
            setKeyIndex(i)
            setZone('grid')
          }}
          onResult={(i) => {
            setResultRow(i)
            setZone('results')
          }}
          onPick={(game, ch) => (ch != null ? typeKey(ch) : play(game))}
        />
      ) : screen === 'games' ? (
        <GameList
          system={system}
          games={games}
          focus={row}
          onFocus={setRow}
          onPick={play}
        />
      ) : (
        <Shelf
          rails={rails}
          focus={focus}
          onFocus={(rail, index) => setFocus({ rail, index })}
          onPick={(rail, item) => (rail.kind === 'system' ? item.count > 0 && openSystem(item.label) : play(item))}
        />
      )}

      <ButtonLegend
        className="relative py-3"
        style={{
          borderTop: `1px solid ${FROG.line}`,
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        }}
        hints={
          screen === 'search'
            ? zone === 'grid'
              ? [
                  { button: 'A', label: 'Type' },
                  { button: 'B', label: query ? 'Delete' : 'Close' },
                  { button: 'RB', label: 'Results' },
                  { button: 'X', label: 'Close' },
                ]
              : [
                  { button: 'A', label: 'Play' },
                  { button: 'Y', label: 'Saves' },
                  { button: 'LB', label: 'Keys' },
                  { button: 'X', label: 'Close' },
                ]
            : screen === 'games'
              ? [
                  { button: 'A', label: 'Play' },
                  { button: 'B', label: 'Shelf' },
                  { button: 'Y', label: 'Saves' },
                  { button: 'X', label: 'Find' },
                  { button: 'LT/RT', label: 'Letter' },
                ]
              : [
                  { button: 'A', label: 'Open' },
                  { button: 'B', label: 'Home HQ' },
                  { button: 'X', label: 'Find' },
                  { button: 'D-pad', label: 'Move' },
                ]
        }
      />
    </div>
  )
}

// The system the shelf's focus implies — a system tile is itself; a game is the
// machine it runs on.
function hovered(rails, focus) {
  return rails?.[focus.rail]?.items?.[focus.index]?.label ?? null
}

