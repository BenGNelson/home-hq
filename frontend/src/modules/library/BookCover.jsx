import { useState } from 'react'
import { bookCoverUrl } from '../../lib/library.js'

// A book's cover thumbnail with a graceful fallback: many books have no embedded
// cover (the proxy 404s), so we show a small 📖 tile instead of a broken image.
// Sized small for the search-result rows; pass className to resize elsewhere.
export default function BookCover({ book, className = '' }) {
  const [failed, setFailed] = useState(false)
  return (
    <div
      className={`relative aspect-[2/3] shrink-0 overflow-hidden rounded bg-slate-800 ${className}`}
    >
      {failed ? (
        <div className="flex h-full w-full items-center justify-center text-slate-500">📖</div>
      ) : (
        <img
          src={bookCoverUrl(book.id)}
          alt={book.title || book.name}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  )
}
