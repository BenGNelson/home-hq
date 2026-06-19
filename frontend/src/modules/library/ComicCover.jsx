import { useState } from 'react'
import { comicCoverUrl } from '../../lib/library.js'

// A comic's cover = its first page, extracted + cached server-side. Graceful
// fallback to a 🦸 tile if the page can't be read (rare). Pass className to size.
export default function ComicCover({ comic, className = '' }) {
  const [failed, setFailed] = useState(false)
  return (
    <div
      className={`relative aspect-[2/3] shrink-0 overflow-hidden rounded bg-slate-800 ${className}`}
    >
      {failed ? (
        <div className="flex h-full w-full items-center justify-center text-2xl text-slate-500">
          🦸
        </div>
      ) : (
        <img
          src={comicCoverUrl(comic.id)}
          alt={comic.name}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  )
}
