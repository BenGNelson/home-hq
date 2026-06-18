import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useApi } from '../../lib/useApi.js'
import { formatSize } from '../../lib/format.js'
import { recordPlayed } from '../../lib/recentGames.js'
import GameCover from './GameCover.jsx'

// A game's "title page": box art + title + a big Play. Fetches the section list
// and finds the item by id, so a direct link / refresh works. Pressing Play
// records it as recently-played, then routes to the player.
export default function GameDetail() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const id = params.get('id')
  const { data, loading } = useApi('/library/games', 0)

  const game = data?.items?.find((it) => it.id === id)

  if (loading && !data) return <p className="p-2 text-sm text-slate-500">loading…</p>
  if (!game) {
    return (
      <div className="space-y-3">
        <p className="text-slate-300">That game isn’t in the library.</p>
        <Link to="/library/games" className="text-sm text-sky-400 hover:underline">
          ← Back to Games
        </Link>
      </div>
    )
  }

  const play = () => {
    recordPlayed(game)
    navigate(
      `/library/play?id=${encodeURIComponent(game.id)}&core=${encodeURIComponent(
        game.core
      )}&name=${encodeURIComponent(game.name)}`
    )
  }

  return (
    <div className="space-y-4">
      <Link to="/library/games" className="text-sm text-slate-400 hover:text-slate-200">
        ← Games
      </Link>

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

          <button
            onClick={play}
            className="rounded-xl bg-sky-600 px-6 py-3 font-medium text-white transition-colors active:bg-sky-700"
          >
            ▶ Play
          </button>

          <p className="text-sm italic text-slate-500">No description yet.</p>
        </div>
      </div>
    </div>
  )
}
