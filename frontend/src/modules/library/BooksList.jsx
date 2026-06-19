import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApi, API_BASE } from '../../lib/useApi.js'
import { readerHref, bookSubtitle } from '../../lib/library.js'

// The Books section. With 10k+ books a flat list is unusable, so this is
// search-first: type a title or author and matches appear (served from the
// metadata index). An empty query shows the first results alphabetically as a
// browseable default. Each result opens in the right reader (EPUB → foliate,
// PDF → PDF.js) via its `reader` hint. Mobile-first, big tap targets.
export default function BooksList() {
  const [input, setInput] = useState('')
  const [results, setResults] = useState(null) // {items,total,query}
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  // Indexer progress — drives the "not configured" and "indexing…" states.
  const status = useApi('/library/books/index-status', 5000).data

  // Debounced search that keeps the previous results visible while the next
  // query is in flight (no flicker between keystrokes), and aborts stale calls.
  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      setLoading(true)
      fetch(`${API_BASE}/library/books/search?q=${encodeURIComponent(input.trim())}&limit=100`, {
        signal: ctrl.signal,
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d) => {
          setResults(d)
          setError(null)
          setLoading(false)
        })
        .catch((e) => {
          if (e.name !== 'AbortError') {
            setError(e.message)
            setLoading(false)
          }
        })
    }, 250)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [input])

  const items = results?.items ?? []
  const total = results?.total ?? 0
  const notConfigured = status && status.configured === false
  const indexing = status && status.running

  return (
    <div className="space-y-4">
      <Link to="/library" className="text-sm text-slate-400 hover:text-slate-200">
        ← Library
      </Link>
      <h2 className="text-xl font-semibold">Books</h2>

      {notConfigured ? (
        <NotConfigured />
      ) : (
        <>
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={total ? `Search ${total.toLocaleString()} books by title or author…` : 'Search books…'}
            autoFocus
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 placeholder-slate-500 outline-none focus:border-slate-500"
          />

          {indexing && (
            <p className="text-xs text-amber-400">
              Indexing your library… {status.processed.toLocaleString()} of{' '}
              {status.total.toLocaleString()} scanned. Search works now; results fill in as it runs.
            </p>
          )}

          {error && <p className="text-sm text-rose-400">search failed — {error}</p>}
          {loading && !results && <p className="text-sm text-slate-500">loading…</p>}

          {results && items.length === 0 && (
            <p className="text-sm text-slate-400">
              {input.trim() ? `No books match “${input.trim()}”.` : 'No books indexed yet.'}
            </p>
          )}

          {items.length > 0 && (
            <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    onClick={() => navigate(readerHref('books', it))}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-800"
                  >
                    <span className="text-xl">📖</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-slate-100">{it.title}</span>
                      <span className="block truncate text-xs text-slate-500">{bookSubtitle(it)}</span>
                    </span>
                    <span className="shrink-0 text-slate-600">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
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
