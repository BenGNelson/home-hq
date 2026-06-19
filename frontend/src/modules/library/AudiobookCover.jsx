import { useState } from 'react'
import { audiobookCoverUrl } from '../../lib/library.js'

// An audiobook's cover (square album art). Falls back to a 🎧 tile when the
// folder has no art — or when it's a collection folder, where the proxy 404s.
export default function AudiobookCover({ path, alt = '', className = '' }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={`relative aspect-square shrink-0 overflow-hidden rounded bg-slate-800 ${className}`}>
      {failed ? (
        <div className="flex h-full w-full items-center justify-center text-2xl text-slate-500">
          🎧
        </div>
      ) : (
        <img
          src={audiobookCoverUrl(path)}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  )
}
