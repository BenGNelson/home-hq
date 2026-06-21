import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi, API_BASE } from '../../lib/useApi.js'
import { useOnline } from '../../lib/online.jsx'
import { useDownloaded } from '../../lib/useDownloaded.js'
import { downloadKey } from '../../lib/offlineStore.js'
import { readerHref, bookSubtitle } from '../../lib/library.js'
import BookCover from './BookCover.jsx'
import OfflineSection from './OfflineSection.jsx'
import SavedBadge from './SavedBadge.jsx'

// The Books section. With 10k+ books a flat list is useless, so this is purely
// search-driven: an empty box just prompts you to search, and results (from the
// metadata index) only render once you type — no giant list to scroll, and no
// odd/garbled titles surfaced by default. Each result opens in the right reader
// (EPUB → foliate, PDF → PDF.js) via its `reader` hint. Mobile-first.
export default function BooksList() {
  const [input, setInput] = useState('')
  const [results, setResults] = useState(null) // {items,total,query} | null
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { online } = useOnline()
  const downloaded = useDownloaded()

  // Indexer status — gives the library size + the "not configured"/"indexing…" UI.
  const status = useApi('/library/books/index-status', 5000).data
  const total = status?.indexed ?? 0
  const notConfigured = status && status.configured === false
  const indexing = status && status.running

  // Search only when there's a term — keep previous results visible while the
  // next query is in flight (no flicker) and abort stale calls. An empty box
  // clears results so we show the prompt instead of a list.
  useEffect(() => {
    const term = input.trim()
    if (!term) {
      setResults(null)
      setError(null)
      setLoading(false)
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      setLoading(true)
      fetch(`${API_BASE}/library/books/search?q=${encodeURIComponent(term)}&limit=100`, {
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

  // Offline, search can't reach the server — show your downloaded books instead,
  // so the section never dead-ends (e.g. closing a reader back onto this page).
  if (!online) return <OfflineSection section="books" label="Books" icon="📖" />

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Books</h2>

      {notConfigured ? (
        <NotConfigured />
      ) : (
        <>
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              total ? `Search ${total.toLocaleString()} books by title or author…` : 'Search books…'
            }
            autoFocus
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 placeholder-slate-500 outline-none focus:border-slate-500"
          />

          {indexing && (
            <p className="text-xs text-amber-400">
              Indexing your library… {status.processed.toLocaleString()} of{' '}
              {status.total.toLocaleString()} scanned. Search works now; results fill in as it runs.
            </p>
          )}

          {/* Empty box → a prompt, not a list. */}
          {!input.trim() && (
            <p className="px-1 pt-6 text-center text-sm text-slate-500">
              {total
                ? `Search your ${total.toLocaleString()} books by title or author.`
                : 'Type to search your books.'}
            </p>
          )}

          {error && <p className="text-sm text-rose-400">search failed — {error}</p>}
          {loading && !results && <p className="text-sm text-slate-500">searching…</p>}

          {input.trim() && results && items.length === 0 && !loading && (
            <p className="text-sm text-slate-400">No books match “{input.trim()}”.</p>
          )}

          {items.length > 0 && (
            <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    onClick={() => navigate(readerHref('books', it))}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-800"
                  >
                    <BookCover book={it} className="w-10" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-slate-100">{it.title}</span>
                      <span className="block truncate text-xs text-slate-500">{bookSubtitle(it)}</span>
                    </span>
                    <SavedBadge saved={downloaded?.has(downloadKey('books', it.id))} />
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
