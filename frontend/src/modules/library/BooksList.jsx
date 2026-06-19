import { Link, useNavigate } from 'react-router-dom'
import { useApi } from '../../lib/useApi.js'
import { formatSize } from '../../lib/format.js'
import { readerHref } from '../../lib/library.js'

// The Books section: a tappable list of ebooks (EPUB/MOBI/AZW3, and PDFs)
// opened in the in-app reader. Plain rows — mobile-first, big tap targets. The
// reader engine is chosen per item (readerHref carries its `reader` hint, so an
// EPUB opens in foliate-js and a PDF book in the PDF reader).
export default function BooksList() {
  const { data, error, loading } = useApi('/library/books', 30000)
  const navigate = useNavigate()

  return (
    <div className="space-y-5">
      <Link to="/library" className="text-sm text-slate-400 hover:text-slate-200">
        ← Library
      </Link>
      <h2 className="text-xl font-semibold">Books</h2>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && data.configured === false && <NotConfigured />}
      {data && data.configured && data.count === 0 && (
        <p className="text-sm text-slate-400">Nothing here yet — drop some ebooks in the folder.</p>
      )}

      {data && data.count > 0 && (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
          {data.items.map((it) => (
            <li key={it.id}>
              <button
                onClick={() => navigate(readerHref('books', it))}
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-800"
              >
                <span className="text-xl">📖</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-slate-100">{it.name}</span>
                  <span className="block text-xs text-slate-500">
                    {it.label}
                    {it.size != null && ` · ${formatSize(it.size)}`}
                  </span>
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
      <p className="text-amber-400">No Books folder configured.</p>
      <p className="mt-2 text-sm text-slate-400">
        Set <code className="rounded bg-slate-800 px-1">BOOKS_DIR</code> (a folder of EPUB/MOBI/AZW3
        files under your storage mount) in <code className="rounded bg-slate-800 px-1">.env</code>.
        See the Server Guide.
      </p>
    </div>
  )
}
