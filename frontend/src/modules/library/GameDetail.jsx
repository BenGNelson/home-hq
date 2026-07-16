import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Star } from 'lucide-react'
import BackLink from '../../components/BackLink.jsx'
import { useApi } from '../../lib/useApi.js'
import { formatSize } from '../../lib/format.js'
import { saveStatesUrl, gameOfflineUrls, gameBackHref, frogHref } from '../../lib/library.js'
import { ensureEmulatorEngine, cacheGameSram } from '../../lib/offlineStore.js'
import { recordPlayed } from '../../lib/recentGames.js'
import { isFavorite, toggleFavorite } from '../../lib/favorites.js'
import GameCover from './GameCover.jsx'
import DownloadButton from './DownloadButton.jsx'
import SaveStateCard from './SaveStateCard.jsx'

// A game's "title page": box art + title + Play, plus its server-side save
// states (roam across devices) — each with a screenshot, Resume (launch into
// that state), and Delete. Fetches the section list and finds the item by id so
// a direct link / refresh works.
export default function GameDetail() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const id = params.get('id')
  // Where the tile was tapped (system + typed search), so Back returns there.
  const ret = params.get('ret')
  const { data, loading } = useApi('/library/games', 0)
  const [refresh, setRefresh] = useState(0)
  const [favorited, setFavorited] = useState(() => isFavorite(id))
  const states = useApi(`/library/games/save-states?id=${encodeURIComponent(id)}&_=${refresh}`, 0)

  const game = data?.items?.find((it) => it.id === id)

  if (loading && !data) return <p className="p-2 text-sm text-slate-500">loading…</p>
  if (!game) {
    return (
      <div className="space-y-3">
        <p className="text-slate-300">That game isn’t in the library.</p>
        <BackLink to={ret || frogHref()}>Back to Games</BackLink>
      </div>
    )
  }

  // slot omitted = fresh boot; slot set = resume into that save state.
  const launch = (slot) => {
    recordPlayed(game)
    const q = `id=${encodeURIComponent(game.id)}&core=${encodeURIComponent(
      game.core
    )}&name=${encodeURIComponent(game.name || '')}&label=${encodeURIComponent(game.label || '')}`
    navigate(`/library/play?${q}${slot ? `&slot=${encodeURIComponent(slot)}` : ''}`)
  }

  const remove = async (slot) => {
    await fetch(`${saveStatesUrl(game.id)}&slot=${encodeURIComponent(slot)}`, { method: 'DELETE' })
    setRefresh((r) => r + 1)
  }

  const slots = states.data?.states ?? []

  return (
    <div className="space-y-5">
      {/* Back to exactly where you were browsing (ret — e.g. Frog with your place
          kept), falling back to Frog, the games home. */}
      <BackLink to={gameBackHref(ret)}>Games</BackLink>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <GameCover game={game} className="w-40 shrink-0 self-center sm:self-start" />
        <div className="min-w-0 space-y-3">
          <div>
            <h2 className="text-2xl font-semibold leading-tight">{game.name}</h2>
            <p className="mt-1 text-sm text-slate-400">
              {game.label}
              {game.size != null && <> · {formatSize(game.size)}</>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => launch()}
              className="rounded-xl bg-sky-600 px-6 py-3 font-medium text-white transition-colors active:bg-sky-700"
            >
              ▶ Play
            </button>
            {/* Star it: shows up on Frog's "Favorites" rail. Optimistic — the store
                write is synchronous, so the fill flips the instant you tap. */}
            <button
              onClick={() => setFavorited(toggleFavorite(game).favorited)}
              aria-pressed={favorited}
              aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
              title={favorited ? 'Favorited' : 'Add to favorites'}
              className={`rounded-xl border px-4 py-3 transition-colors ${
                favorited
                  ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200'
              }`}
            >
              <Star className="h-5 w-5" fill={favorited ? 'currentColor' : 'none'} aria-hidden="true" />
            </button>
            {/* Save the ROM + its core (+ the shared engine, once) so the game
                plays in airplane mode. The in-game (SRAM) save is seeded too, so
                opening it offline resumes via "Continue". */}
            <DownloadButton
              item={{
                section: 'games',
                id: game.id,
                name: game.name,
                core: game.core,
                urls: gameOfflineUrls(game.id, game.core),
              }}
              onBefore={async () => {
                await ensureEmulatorEngine()
                await cacheGameSram(game.id) // seed the in-game save for offline-first play
              }}
            />
          </div>
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium uppercase tracking-wide text-slate-500">Save states</h3>
        {slots.length === 0 ? (
          <p className="text-sm text-slate-500">
            None yet. Open the in-game menu and choose <em>Save State</em> while playing — it’ll
            appear here to resume from any device.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {slots.map((s) => (
              <SaveStateCard
                key={s.slot}
                game={game}
                state={s}
                onSelect={() => launch(s.slot)}
                onDelete={() => remove(s.slot)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
