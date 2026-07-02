import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useApi } from '../../lib/useApi.js'
import { useOnline } from '../../lib/online.jsx'
import { useDownloaded } from '../../lib/useDownloaded.js'
import { downloadKey } from '../../lib/offlineStore.js'
import {
  listSystems,
  systemGames,
  groupByLetter,
  searchItems,
  coverUrl,
  sectionAccent,
  gamesSystemHref,
  gameDetailHref,
} from '../../lib/library.js'
import { radiantBackdrop } from '../../lib/glow.js'
import { ACCENT_HOVER } from '../../lib/moduleAccent.js'
import { getRecent, removeRecent } from '../../lib/recentGames.js'
import { SkeletonLine } from '../../components/ui.jsx'
import GameCover from './GameCover.jsx'
import OfflineSection from './OfflineSection.jsx'
import SavedBadge from './SavedBadge.jsx'
import AlphaScrubber from './AlphaScrubber.jsx'
import RemoveButton from './RemoveButton.jsx'

// The games accent (violet) as an "r,g,b" string, for the system cards' glow.
const GAMES_RGB = sectionAccent('games').rgb

// The Games section browses one system at a time — Game Boy alone has hundreds
// of titles, so a single stacked grid is unscrollable. The landing shows
// "Recently played" + a collage card per system; tapping a system drills into
// ?system=<label> and lists its games alphabetically, with sticky letter headers
// and an A→Z scrubber for fast jumps, plus a search box scoped to that system.
// Mobile-first — covers are big tap targets. (Same drill-in shape as Comics.)
export default function GamesList() {
  const { data, error, loading } = useApi('/library/games', 30000)
  const { online } = useOnline()
  const [params] = useSearchParams()
  const system = params.get('system') || ''
  // Read on mount; returning from a game remounts this page, so it stays fresh.
  // ✕ on a tile removes it (clears the recently-played marker, not the saves).
  const [recent, setRecent] = useState(() => getRecent())
  const removeRecentGame = (g) => setRecent(removeRecent(g.id))

  // Offline, the library can't load — show the games you've downloaded.
  if (!online) return <OfflineSection section="games" label="Games" />

  return (
    <div className="space-y-5">
      {/* Skeleton (not bare "loading…") so the pills, recently-played row, and
          systems grid hold their shape on first load — no bounce. */}
      {loading && !data && (system ? <SystemViewSkeleton /> : <LandingSkeleton />)}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && data.configured === false && <NotConfigured />}
      {data && data.configured && data.count === 0 && <EmptyLibrary />}

      {data && data.count > 0 &&
        (system ? (
          <SystemView items={data.items} system={system} />
        ) : (
          <Landing items={data.items} recent={recent} onRemoveRecent={removeRecentGame} />
        ))}
    </div>
  )
}

// The landing: recently played, then a card per system.
function Landing({ items, recent, onRemoveRecent }) {
  return (
    <>
      <h2 className="text-xl font-semibold">Games</h2>
      <RecentlyPlayed recent={recent} items={items} onRemove={onRemoveRecent} />
      <section className="space-y-2">
        <h3 className="text-sm font-medium uppercase tracking-wide text-slate-500">Systems</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {listSystems(items).map((sys) => (
            <SystemCard key={sys.label} sys={sys} />
          ))}
        </div>
      </section>
    </>
  )
}

// A system tile: a 2×2 quilt of box art (the first few titles) with the system
// name + game count, wrapped in the back-lit radiance motif (games accent).
function SystemCard({ sys }) {
  const navigate = useNavigate()
  return (
    // Resting state keeps its faint violet radiance; on desktop hover it lifts +
    // glows in the games accent (shared ACCENT_HOVER, like the dashboard cards).
    <button
      onClick={() => navigate(gamesSystemHref(sys.label))}
      className={`rounded-2xl border border-violet-500/25 p-3 text-left active:scale-[0.98] ${ACCENT_HOVER}`}
      style={{ background: radiantBackdrop(GAMES_RGB, 0.12), '--accent': `rgb(${GAMES_RGB})` }}
    >
      {/* A decorative box-art quilt — raw <img>s (not GameCover) on purpose: the
          tiles want no titled fallback, just a missing cover fading to the slate
          backdrop, so the collage stays purely visual. */}
      <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-lg">
        {sys.covers.map((id) => (
          <span key={id} className="aspect-[3/4] overflow-hidden rounded bg-slate-800">
            <img
              src={coverUrl(id)}
              alt=""
              loading="lazy"
              decoding="async"
              onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
              className="h-full w-full object-cover"
            />
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate font-medium text-slate-100">{sys.label}</span>
          <span className="block text-xs text-slate-500">{sys.count} games</span>
        </span>
        <span className="shrink-0 text-slate-600 transition group-hover:translate-x-0.5 group-active:translate-x-0.5">›</span>
      </div>
    </button>
  )
}

// One system's games, alphabetised: a breadcrumb, a search box scoped to this
// system, then either flat search results or letter-grouped sections with the
// A→Z scrubber. Letter section headers are sticky and carry the scroll-target id.
function SystemView({ items, system }) {
  // Search text lives in the URL (`?system=…&q=…`), not local state, so it
  // survives opening a game + coming back (this view remounts on return) and is
  // refresh/share-safe. Each keystroke replaces (not pushes) history so typing
  // doesn't stack Back entries; clearing the box drops `q` from the URL.
  const [params, setParams] = useSearchParams()
  const query = params.get('q') || ''
  const setQuery = (val) => {
    const next = new URLSearchParams(params)
    if (val) next.set('q', val)
    else next.delete('q')
    setParams(next, { replace: true })
  }
  // Memoised: a big system (hundreds of titles) is filtered + natural-sorted, so
  // don't redo it on every keystroke; the letter grouping is only needed when
  // not searching (the search branch shows a flat result grid instead).
  const games = useMemo(() => systemGames(items, system), [items, system])
  const searching = query.trim().length > 0
  const groups = useMemo(() => (searching ? [] : groupByLetter(games)), [games, searching])
  const pick = (letter) =>
    document.getElementById(`games-letter-${letter}`)?.scrollIntoView({ block: 'start' })

  return (
    <div className="space-y-4 pr-7">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-slate-400">
        <Link to="/library/games" className="hover:text-slate-200">
          Games
        </Link>
        <span className="px-1 text-slate-600">/</span>
        <span className="text-slate-200">{system}</span>
      </nav>

      {games.length === 0 ? (
        // An unknown/stale ?system= (a renamed system, an old bookmark) — don't
        // strand the user on an empty scrubber; say so and offer the way back.
        <p className="text-sm text-slate-400">
          No games found for “{system}”. It may have been renamed or removed —{' '}
          <Link to="/library/games" className="text-violet-300 hover:text-violet-200">
            back to all systems
          </Link>
          .
        </p>
      ) : (
        <>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${games.length.toLocaleString()} ${system} games…`}
            aria-label={`Search ${system} games`}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 placeholder-slate-500 outline-none focus:border-slate-500"
          />

          {searching ? (
            <SearchResults games={searchItems(games, query)} query={query} />
          ) : (
            <>
              {groups.map((g) => (
                <section key={g.letter} className="space-y-2">
                  <h3
                    id={`games-letter-${g.letter}`}
                    className="sticky top-0 z-10 -mx-1 bg-slate-950/80 px-1 py-1 text-sm font-semibold uppercase tracking-wide text-slate-400 backdrop-blur"
                  >
                    {g.letter}
                  </h3>
                  <GameGrid games={g.items} />
                </section>
              ))}
              <AlphaScrubber letters={new Set(groups.map((g) => g.letter))} onPick={pick} />
            </>
          )}
        </>
      )}
    </div>
  )
}

function SearchResults({ games, query }) {
  if (games.length === 0) {
    return <p className="text-sm text-slate-400">No games match “{query.trim()}”.</p>
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">{games.length.toLocaleString()} match</p>
      <GameGrid games={games} />
    </div>
  )
}

// Show recently-played games that still exist in the library. The ✕ on each tile
// removes it from the row (same affordance as the hub's "Jump back in" shelf).
function RecentlyPlayed({ recent, items, onRemove }) {
  const present = new Set(items.map((i) => i.id))
  const games = recent.filter((g) => present.has(g.id)).slice(0, 6)
  if (games.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium uppercase tracking-wide text-slate-500">Recently played</h3>
      <GameGrid games={games} onRemove={onRemove} />
    </section>
  )
}

// The shared box-art grid: a cover button per game, with a downloaded badge. Tap
// opens the game's detail "title page". Reused by recently-played, the per-letter
// sections, and search results. When `onRemove` is passed (recently-played), each
// tile gets a ✕ to drop it — and the downloaded badge moves to the top-left so
// the two don't collide.
function GameGrid({ games, onRemove }) {
  const navigate = useNavigate()
  const location = useLocation()
  const downloaded = useDownloaded()
  // Remember exactly where this grid is (system + typed search) so the game's
  // Back link returns here mid-search, not to a fresh Games page.
  const ret = location.pathname + location.search
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {games.map((g) => (
        <div key={g.id} className="relative">
          <button
            onClick={() => navigate(gameDetailHref(g.id, ret))}
            className="group block w-full text-left"
          >
            <span className="relative block">
              <GameCover game={g} className="transition-transform group-active:scale-95" />
              {downloaded?.has(downloadKey('games', g.id)) && (
                <span className={`absolute top-1 ${onRemove ? 'left-1' : 'right-1'}`}>
                  <SavedBadge saved />
                </span>
              )}
            </span>
            <span className="mt-1 block truncate text-xs text-slate-300">{g.name}</span>
          </button>
          {onRemove && (
            <RemoveButton
              onClick={() => onRemove(g)}
              label={`Remove ${g.name} from Recently played`}
              className="absolute right-1 top-1 h-8 w-8"
            />
          )}
        </div>
      ))}
    </div>
  )
}

// --- loading skeletons (mirror the real layout so nothing bounces) ----------

// A box-art cover tile placeholder (cover + title line).
function CoverTile() {
  return (
    <div className="space-y-1">
      <div className="aspect-[3/4] w-full animate-pulse rounded-lg bg-slate-800" />
      <SkeletonLine className="h-3 w-full" />
    </div>
  )
}

// A cover grid at the same breakpoints as GameGrid, so it lines up.
function CoverRow({ count = 6 }) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <CoverTile key={i} />
      ))}
    </div>
  )
}

// The landing placeholder: "Games" heading + recently-played row + systems grid,
// at the same breakpoints as the live content so phone/iPad/desktop line up.
function LandingSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <SkeletonLine className="h-7 w-28" />
      <section className="space-y-2">
        <SkeletonLine className="h-4 w-32" />
        <CoverRow />
      </section>
      <section className="space-y-2">
        <SkeletonLine className="h-4 w-20" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
              <div className="grid grid-cols-2 gap-1">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="aspect-[3/4] animate-pulse rounded bg-slate-800" />
                ))}
              </div>
              <div className="mt-2 space-y-1.5">
                <SkeletonLine className="h-4 w-20" />
                <SkeletonLine className="h-3 w-12" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

// The system-view placeholder: breadcrumb + search box + a couple letter rows.
function SystemViewSkeleton() {
  return (
    <div className="space-y-4 pr-7" aria-hidden="true">
      <SkeletonLine className="h-4 w-40" />
      <SkeletonLine className="h-12 w-full rounded-xl" />
      {Array.from({ length: 2 }).map((_, i) => (
        <section key={i} className="space-y-2">
          <SkeletonLine className="h-5 w-6" />
          <CoverRow />
        </section>
      ))}
    </div>
  )
}

function NotConfigured() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <p className="text-amber-400">No games library configured.</p>
      <p className="mt-2 text-sm text-slate-400">
        Set <code className="rounded bg-slate-800 px-1">GAMES_ROM_DIR</code> (a folder under
        your storage mount) in <code className="rounded bg-slate-800 px-1">.env</code>, drop in
        some <code className="rounded bg-slate-800 px-1">.gb</code>/
        <code className="rounded bg-slate-800 px-1">.gbc</code>/
        <code className="rounded bg-slate-800 px-1">.gba</code> ROMs, and run
        <code className="mx-1 rounded bg-slate-800 px-1">scripts/fetch-emulatorjs.sh</code> to
        install the emulator engine. See the Server Guide.
      </p>
    </div>
  )
}

function EmptyLibrary() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <p className="text-slate-300">No games found yet.</p>
      <p className="mt-2 text-sm text-slate-400">
        Drop <code className="rounded bg-slate-800 px-1">.gb</code>/
        <code className="rounded bg-slate-800 px-1">.gbc</code>/
        <code className="rounded bg-slate-800 px-1">.gba</code> files into your configured ROM
        folder — they’ll appear here.
      </p>
    </div>
  )
}
