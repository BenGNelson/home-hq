import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../../lib/useApi.js'
import { useOnline } from '../../lib/online.jsx'
import { useDownloaded } from '../../lib/useDownloaded.js'
import { downloadKey } from '../../lib/offlineStore.js'
import { groupByLabel } from '../../lib/library.js'
import { getRecent } from '../../lib/recentGames.js'
import GameCover from './GameCover.jsx'
import OfflineSection from './OfflineSection.jsx'
import SavedBadge from './SavedBadge.jsx'

// The Games section: a "Recently Played" row (client-side, this device) above a
// box-art grid grouped by system. Tapping a game opens its detail page (the
// "title page"). Mobile-first — covers are big tap targets.
export default function GamesList() {
  const { data, error, loading } = useApi('/library/games', 30000)
  const { online } = useOnline()
  // Read on mount; returning from a game remounts this page, so it stays fresh.
  const [recent] = useState(() => getRecent())

  // Offline, the library can't load — show the games you've downloaded.
  if (!online) return <OfflineSection section="games" label="Games" icon="🎮" />

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Games</h2>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && data.configured === false && <NotConfigured />}
      {data && data.configured && data.count === 0 && <EmptyLibrary />}

      {data && data.count > 0 && (
        <>
          <RecentlyPlayed recent={recent} items={data.items} />
          {groupByLabel(data.items).map(([label, list]) => (
            <Section key={label} title={label} games={list} />
          ))}
        </>
      )}
    </div>
  )
}

// Show recently-played games that still exist in the library.
function RecentlyPlayed({ recent, items }) {
  const present = new Set(items.map((i) => i.id))
  const games = recent.filter((g) => present.has(g.id)).slice(0, 6)
  if (games.length === 0) return null
  return (
    <Section title="Recently played" games={games} />
  )
}

function Section({ title, games }) {
  const navigate = useNavigate()
  const downloaded = useDownloaded()
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium uppercase tracking-wide text-slate-500">{title}</h3>
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
    </section>
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
