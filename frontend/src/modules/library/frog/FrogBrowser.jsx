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
import { FrogMark } from './Frog.jsx'
import Boot from './Boot.jsx'
import Shelf from './Shelf.jsx'
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
// The actions that move the shelf. Anything else is inert here (X = search isn't
// built yet), and inert must mean inert — not "quietly re-render".
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

  const rails = useMemo(() => buildShelf(items, getRecent()), [items])
  const games = useMemo(() => (system ? systemGames(items, system) : []), [items, system])

  useEffect(() => {
    if (screen === 'boot') return
    Object.assign(place, { booted: true, screen, system, focus, row })
  })

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
        game.name
      )}`
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

  // Everything the controller can do, in one place, keyed by which screen is up.
  // Held in a ref so the poll loop is installed once and never re-installed mid-press.
  const act = useRef(() => {})
  act.current = (action) => {
    if (screen === 'boot') return
    // Nothing to point at yet. Without this, presses land against the skeleton's
    // placeholder rails and strand focus the moment the real ones arrive.
    if (loading && !items.length) return

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
  useEffect(() => {
    const onKey = (e) => {
      const map = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        Enter: 'confirm',
        Escape: 'back',
        PageUp: 'railPrev',
        PageDown: 'railNext',
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

  const accent = systemStyle(screen === 'games' ? system : hovered(rails, focus)).accent

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
              FROG
            </span>
          </div>
        )}

        <button
          onClick={() => (screen === 'games' ? setScreen('shelf') : navigate('/library/games'))}
          className="shrink-0 rounded-full p-2"
          style={{ background: FROG.panel, color: FROG.soft }}
          aria-label={screen === 'games' ? 'Back to the shelf' : 'Leave Frog'}
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
          screen === 'games'
            ? [
                { button: 'A', label: 'Play' },
                { button: 'B', label: 'Shelf' },
                { button: 'Y', label: 'Saves' },
                { button: 'LB/RB', label: 'Skip 10' },
                { button: 'LT/RT', label: 'Letter' },
              ]
            : [
                { button: 'A', label: 'Open' },
                { button: 'B', label: 'Home HQ' },
                { button: 'Y', label: 'Saves' },
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

