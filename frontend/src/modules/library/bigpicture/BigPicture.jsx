import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { useApi } from '../../../lib/useApi.js'
import { listSystems, systemGames, gameDetailHref } from '../../../lib/library.js'
import { getRecent, recordPlayed } from '../../../lib/recentGames.js'
import { moveInRails } from '../../../lib/gridNav.js'
import { useGamepad } from '../../../lib/useGamepad.js'
import { SkeletonLine } from '../../../components/ui.jsx'
import ButtonLegend from '../player/ButtonLegend.jsx'
import HeroBackdrop from './HeroBackdrop.jsx'
import Rail from './Rail.jsx'

// "Big Picture" — the library as a console dashboard, for the iPad-plus-controller
// case. The regular Games pages are built for a thumb; this is built for a D-pad
// across the room: big art, one rail per system, and the focused game's cover
// blurred across the whole screen behind it.
//
// Focus is index arithmetic over rails (lib/gridNav.js), not DOM measurement, which
// is what lets exactly the same code answer to a controller, the arrow keys and a
// mouse without any of them being a special case.
export default function BigPicture() {
  const navigate = useNavigate()
  const { data, loading } = useApi('/library/games', 0)

  const [focus, setFocus] = useState({ rail: 0, index: 0 })
  const [memory, setMemory] = useState({})
  // Did the controller/keyboard move focus, or the mouse? Only the former should
  // scroll the rail — see the loop described in Rail.jsx.
  const [autoScroll, setAutoScroll] = useState(true)

  const rails = useMemo(() => {
    const items = data?.items ?? []
    if (!items.length) return []

    // "Continue playing" first — the reason you opened this at all, most of the
    // time. Recents are stored as bare markers, so match them back to live items;
    // a game that has since left the library simply drops out.
    const byId = new Map(items.map((g) => [g.id, g]))
    const recent = getRecent()
      .map((r) => byId.get(r.id))
      .filter(Boolean)

    const systems = listSystems(items).map((s) => ({
      id: s.label,
      title: s.label,
      items: systemGames(items, s.label),
    }))

    return [...(recent.length ? [{ id: 'continue', title: 'Continue playing', items: recent }] : []), ...systems]
  }, [data])

  const current = rails[focus.rail]?.items?.[focus.index] ?? null

  const play = useCallback(
    (game) => {
      if (!game) return
      recordPlayed(game)
      const q = `id=${encodeURIComponent(game.id)}&core=${encodeURIComponent(game.core)}&name=${encodeURIComponent(
        game.name
      )}`
      // No ?slot=: "Continue" boots the game's own in-game save, not an older
      // snapshot. Restoring a save state here would roll the battery save back to
      // whenever that snapshot was taken.
      navigate(`/library/play?${q}`)
    },
    [navigate]
  )

  const move = useCallback(
    (dir) => {
      setAutoScroll(true)
      const next = moveInRails(rails, focus, dir, memory)
      setMemory(next.memory)
      setFocus(next.focus)
    },
    [rails, focus, memory]
  )

  const pointTo = useCallback((rail, index) => {
    setAutoScroll(false)
    setFocus((f) => (f.rail === rail && f.index === index ? f : { rail, index }))
  }, [])

  // The focused game, held in a ref so the gamepad handlers don't need to be
  // rebuilt (and the poll loop re-installed) every time focus moves.
  const currentRef = useRef(current)
  currentRef.current = current

  useGamepad({
    onAction: (action) => {
      if (action === 'confirm') play(currentRef.current)
      else if (action === 'back') navigate('/library/games')
      else if (action === 'alt') {
        // Y opens the game's page, where its save states live.
        const g = currentRef.current
        if (g) navigate(gameDetailHref(g.id, '/library/games/tv'))
      } else move(action)
    },
    onMenuAction: (a) => {
      if (a === 'start') play(currentRef.current)
    },
  })

  // Keyboard parity — the same moves, so a desktop can drive this too.
  useEffect(() => {
    const onKey = (e) => {
      const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key]
      if (dir) {
        e.preventDefault()
        move(dir)
      } else if (e.key === 'Enter') play(currentRef.current)
      else if (e.key === 'Escape') navigate('/library/games')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, play, navigate])

  return (
    <div data-testid="big-picture" className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-slate-950">
      <HeroBackdrop game={current} />

      <div
        className="relative flex min-h-0 flex-1 flex-col"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        }}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-4">
          <div className="min-w-0">
            {current ? (
              <>
                <h1 className="truncate text-2xl font-semibold text-slate-50 sm:text-3xl">{current.name}</h1>
                <p className="mt-1 text-sm text-slate-400">{current.label}</p>
              </>
            ) : (
              !loading && <h1 className="text-xl text-slate-400">No games in the library yet.</h1>
            )}
          </div>
          <button
            onClick={() => navigate('/library/games')}
            className="shrink-0 rounded-full bg-slate-900/70 p-2 text-slate-300 backdrop-blur-sm active:bg-slate-800"
            aria-label="Exit Big Picture"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pb-2">
          {loading && !rails.length && (
            <div className="space-y-3 px-6">
              <SkeletonLine className="h-4 w-40" />
              <div className="flex gap-4">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="aspect-[3/4] w-28 shrink-0 rounded-lg bg-slate-800/60 sm:w-32" />
                ))}
              </div>
            </div>
          )}

          {rails.map((rail, r) => (
            <Rail
              key={rail.id}
              title={rail.title}
              items={rail.items}
              focused={r === focus.rail}
              focusIndex={focus.index}
              autoScroll={autoScroll}
              onFocus={(i) => pointTo(r, i)}
              onPick={play}
            />
          ))}
        </div>

        <ButtonLegend
          className="border-t border-slate-800/80 bg-slate-950/80 py-3 backdrop-blur-sm"
          hints={[
            { button: 'A', label: 'Play' },
            { button: 'B', label: 'Back' },
            { button: 'Y', label: 'Saves' },
            { button: 'LB', label: 'Rail' },
            { button: 'RB', label: 'Rail' },
          ]}
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        />
      </div>
    </div>
  )
}
