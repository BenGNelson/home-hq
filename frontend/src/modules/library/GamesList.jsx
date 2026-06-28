import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
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
} from '../../lib/library.js'
import { radiantBackdrop } from '../../lib/glow.js'
import { getRecent } from '../../lib/recentGames.js'
import GameCover from './GameCover.jsx'
import OfflineSection from './OfflineSection.jsx'
import SavedBadge from './SavedBadge.jsx'
import AlphaScrubber from './AlphaScrubber.jsx'

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
  const [recent] = useState(() => getRecent())

  // Offline, the library can't load — show the games you've downloaded.
  if (!online) return <OfflineSection section="games" label="Games" />

  return (
    <div className="space-y-5">
      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && data.configured === false && <NotConfigured />}
      {data && data.configured && data.count === 0 && <EmptyLibrary />}

      {data && data.count > 0 &&
        (system ? (
          <SystemView items={data.items} system={system} />
        ) : (
          <Landing items={data.items} recent={recent} />
        ))}
    </div>
  )
}

// The landing: recently played, then a card per system.
function Landing({ items, recent }) {
  return (
    <>
      <h2 className="text-xl font-semibold">Games</h2>
      <RecentlyPlayed recent={recent} items={items} />
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
  const accent = sectionAccent('games')
  return (
    <button
      onClick={() => navigate(`/library/games?system=${encodeURIComponent(sys.label)}`)}
      className="group rounded-2xl border p-3 text-left transition active:scale-[0.98]"
      style={{ borderColor: `rgba(${accent.rgb},0.25)`, background: radiantBackdrop(accent.rgb, 0.12) }}
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
        <span className="shrink-0 text-slate-600 transition group-active:translate-x-0.5">›</span>
      </div>
    </button>
  )
}

// One system's games, alphabetised: a breadcrumb, a search box scoped to this
// system, then either flat search results or letter-grouped sections with the
// A→Z scrubber. Letter section headers are sticky and carry the scroll-target id.
function SystemView({ items, system }) {
  const [query, setQuery] = useState('')
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

// Show recently-played games that still exist in the library.
function RecentlyPlayed({ recent, items }) {
  const present = new Set(items.map((i) => i.id))
  const games = recent.filter((g) => present.has(g.id)).slice(0, 6)
  if (games.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium uppercase tracking-wide text-slate-500">Recently played</h3>
      <GameGrid games={games} />
    </section>
  )
}

// The shared box-art grid: a cover button per game, with a downloaded badge. Tap
// opens the game's detail "title page". Reused by recently-played, the per-letter
// sections, and search results.
function GameGrid({ games }) {
  const navigate = useNavigate()
  const downloaded = useDownloaded()
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {games.map((g) => (
        <button
          key={g.id}
          onClick={() => navigate(`/library/games/detail?id=${encodeURIComponent(g.id)}`)}
          className="group text-left"
        >
          <span className="relative block">
            <GameCover game={g} className="transition-transform group-active:scale-95" />
            {downloaded?.has(downloadKey('games', g.id)) && (
              <span className="absolute right-1 top-1">
                <SavedBadge saved />
              </span>
            )}
          </span>
          <span className="mt-1 block truncate text-xs text-slate-300">{g.name}</span>
        </button>
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
