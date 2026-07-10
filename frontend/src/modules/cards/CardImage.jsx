import { useState } from 'react'
import { cardImageUrl } from '../../lib/cards.js'

// A card face with a graceful fallback: if the proxy 404s (no image), show a
// titled placeholder instead of a broken image. `dim` grays + fades the whole
// tile — used for cards you DON'T own in a set grid, so owned cards pop.
// Aspect 5:7 is the standard Pokémon card ratio (63×88mm).
export default function CardImage({ card, size = 'small', dim = false, className = '' }) {
  const [failed, setFailed] = useState(false)
  return (
    <div
      className={`relative aspect-[5/7] overflow-hidden rounded-lg bg-slate-800 ${
        dim ? 'opacity-40 grayscale' : ''
      } ${className}`}
    >
      {failed ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
          <span className="line-clamp-3 text-xs font-medium text-slate-300">{card.name}</span>
          <span className="text-[11px] text-slate-500">#{card.number}</span>
        </div>
      ) : (
        <img
          src={cardImageUrl(card.id, size)}
          alt={card.name}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  )
}
