import { useState } from 'react'
import { coverUrl } from '../../lib/library.js'

// Box art with a graceful fallback: if there's no match (e.g. a ROM hack), the
// proxy 404s and we show a titled placeholder instead of a broken image.
export default function GameCover({ game, className = '' }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={`relative aspect-[3/4] overflow-hidden rounded-lg bg-slate-800 ${className}`}>
      {failed ? (
        <div className="flex h-full w-full items-center justify-center p-2 text-center">
          <span className="line-clamp-4 text-sm font-medium text-slate-300">{game.name}</span>
        </div>
      ) : (
        <img
          src={coverUrl(game.id)}
          alt={game.name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  )
}
