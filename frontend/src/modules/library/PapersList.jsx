import { useNavigate } from 'react-router-dom'
import BackLink from '../../components/BackLink.jsx'
import { useApi } from '../../lib/useApi.js'
import { formatSize } from '../../lib/format.js'
import { readerHref } from '../../lib/library.js'

// The Magazines & Papers section: a tappable list of PDFs opened in the in-app
// reader. Plain rows (no cover art) — mobile-first, big tap targets.
export default function PapersList() {
  const { data, error, loading } = useApi('/library/papers', 30000)
  const navigate = useNavigate()

  return (
    <div className="space-y-5">
      <BackLink to="/library">Library</BackLink>
      <h2 className="text-xl font-semibold">Magazines &amp; Papers</h2>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && data.configured === false && <NotConfigured />}
      {data && data.configured && data.count === 0 && (
        <p className="text-sm text-slate-400">Nothing here yet — drop some PDFs in the folder.</p>
      )}

      {data && data.count > 0 && (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
          {data.items.map((it) => (
            <li key={it.id}>
              <button
                onClick={() => navigate(readerHref('papers', it))}
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-800"
              >
                <span className="text-xl">📄</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-slate-100">{it.name}</span>
                  {it.size != null && (
                    <span className="block text-xs text-slate-500">{formatSize(it.size)}</span>
                  )}
                </span>
                <span className="shrink-0 text-slate-600">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NotConfigured() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <p className="text-amber-400">No Magazines &amp; Papers folder configured.</p>
      <p className="mt-2 text-sm text-slate-400">
        Set <code className="rounded bg-slate-800 px-1">PAPERS_DIR</code> (a folder of PDFs under
        your storage mount) in <code className="rounded bg-slate-800 px-1">.env</code>. See the
        Server Guide.
      </p>
    </div>
  )
}
