import { useApi, API_BASE } from '../../../lib/useApi.js'

// A horizontally-scrolling strip of poster art for the newest Plex additions.
// Posters come through the backend art proxy (token stays server-side).
export default function RecentlyAdded() {
  const { data } = useApi('/plex/recently-added', 60000)
  const items = data?.items ?? []
  if (items.length === 0) return null

  return (
    <section className="mt-6">
      <h3 className="mb-3 text-sm font-medium text-slate-400">Recently added to Plex</h3>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {items.map((it, i) => (
          <div key={`${it.rating_key}-${i}`} className="w-28 shrink-0">
            <div className="aspect-[2/3] overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
              <img
                src={`${API_BASE}/plex/art/${it.rating_key}`}
                alt={it.title}
                loading="lazy"
                className="h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.visibility = 'hidden'
                }}
              />
            </div>
            <p className="mt-1 truncate text-xs text-slate-300" title={it.title}>
              {it.title}
            </p>
            {it.subtitle && (
              <p className="truncate text-[11px] text-slate-500">{it.subtitle}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
