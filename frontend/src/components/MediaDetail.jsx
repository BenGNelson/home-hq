import { useEffect, useState } from 'react'
import { API_BASE } from '../lib/useApi.js'
import { Spinner } from './ui.jsx'
import { formatBytes, formatDate, formatDuration, formatResolution } from '../lib/format.js'

// A poster + metadata header for a single movie/show, fetched live from Plex.
// `fallbackTitle` (from the cache) is shown if the live fetch fails so the page
// still has a heading when Plex is unreachable.
export default function MediaDetail({ ratingKey, fallbackTitle, onLoaded }) {
  const [d, setD] = useState(null)
  const [loading, setLoading] = useState(true)
  const [imgOk, setImgOk] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setImgOk(true)
    fetch(`${API_BASE}/plex/item/${ratingKey}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) {
          setD(j)
          setLoading(false)
          onLoaded?.(j)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ratingKey])

  const box = 'mb-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4'

  if (loading) {
    return (
      <div className={box}>
        <Spinner label="loading details…" />
      </div>
    )
  }

  if (!d || d.found === false) {
    return (
      <div className={box}>
        <h2 className="text-xl font-semibold">{fallbackTitle ?? 'Details'}</h2>
        <p className="mt-1 text-xs text-amber-400">details unavailable</p>
      </div>
    )
  }

  // Compact "fact" chips for the metadata line.
  const facts = [
    d.year,
    d.content_rating,
    d.rating ? `★ ${d.rating}` : null,
    d.type === 'show'
      ? [d.seasons && `${d.seasons} seasons`, d.episodes && `${d.episodes} eps`]
          .filter(Boolean)
          .join(' · ')
      : formatDuration(d.duration_ms),
    d.type === 'movie' ? formatResolution(d.resolution) : null,
    d.type === 'movie' && d.file_size ? formatBytes(d.file_size) : null,
  ].filter(Boolean)

  return (
    <div className={`${box} flex flex-col gap-4 sm:flex-row`}>
      {imgOk && (
        <img
          src={`${API_BASE}/plex/art/${ratingKey}`}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setImgOk(false)}
          className="h-44 w-auto self-start rounded-lg border border-slate-800 object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-semibold">{d.title}</h2>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
          {facts.map((f, i) => (
            <span key={i} className="flex items-center gap-2">
              {i > 0 && <span className="text-slate-600">·</span>}
              {f}
            </span>
          ))}
        </div>

        {d.genres?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {d.genres.map((g) => (
              <span
                key={g}
                className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300"
              >
                {g}
              </span>
            ))}
          </div>
        )}

        {d.summary && (
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-slate-300">
            {d.summary}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {d.studio && <span>{d.studio}</span>}
          {d.directors?.length > 0 && <span>Dir. {d.directors.join(', ')}</span>}
          {d.type === 'movie' && d.codec && (
            <span className="uppercase">{d.codec}</span>
          )}
          {d.added_at && <span>Added {formatDate(d.added_at)}</span>}
        </div>
      </div>
    </div>
  )
}
