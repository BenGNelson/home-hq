import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useApi, API_BASE } from '../../lib/useApi.js'
import { useOnline } from '../../lib/online.jsx'
import { useDownloaded } from '../../lib/useDownloaded.js'
import { downloadKey } from '../../lib/offlineStore.js'
import {
  readerHref,
  textbookCoverUrl,
  browseFolder,
  searchItems,
  folderCrumbs,
  pinLabel,
  pinsUrl,
} from '../../lib/library.js'
import BookCover from './BookCover.jsx'
import OfflineSection from './OfflineSection.jsx'
import SavedBadge from './SavedBadge.jsx'
import { Star, X, GraduationCap } from 'lucide-react'

const PAGE = 60 // titles rendered per "page" — keeps a big sub-category from choking

// The Textbooks section: reference / informational books organized into
// sub-category folders on disk (Programming, Cooking, Game Design, …). Same
// folder-browser shape as Comics — mirrors the tree at any depth, plus a search
// box across every textbook and pinned folders (star a sub-category to keep it
// one tap away). Items open in the same PDF/EPUB readers as Books. The current
// folder lives in ?path= so the back gesture walks back up the tree.
export default function TextbooksList() {
  const { data, error, loading } = useApi('/library/textbooks', 30000)
  const { online } = useOnline()
  const [params] = useSearchParams()
  const path = params.get('path') || ''
  const [query, setQuery] = useState('')

  // Pinned folders (server-side, roam across devices). Loaded once; mutated
  // optimistically on toggle (re-synced from the server if a write fails).
  const [pins, setPins] = useState([])
  const reloadPins = () =>
    fetch(pinsUrl('textbooks'))
      .then((r) => r.json())
      .then((d) => setPins(d.pins))
      .catch(() => {})
  useEffect(() => {
    reloadPins()
  }, [])
  const pinnedSet = new Set(pins.map((p) => p.path))
  const togglePin = (folderPath) => {
    const pinned = pinnedSet.has(folderPath)
    setPins((prev) =>
      pinned
        ? prev.filter((p) => p.path !== folderPath)
        : [{ section: 'textbooks', path: folderPath, created_ms: Date.now() }, ...prev]
    )
    const opts = pinned
      ? [`${API_BASE}/library/pins?section=textbooks&path=${encodeURIComponent(folderPath)}`, { method: 'DELETE' }]
      : [
          `${API_BASE}/library/pins`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ section: 'textbooks', path: folderPath }),
          },
        ]
    fetch(...opts)
      .then((r) => {
        if (!r.ok) reloadPins()
      })
      .catch(reloadPins)
  }

  const items = data?.items ?? []
  const crumbs = folderCrumbs(path)
  const searching = query.trim().length > 0

  // Offline, the folder browser + covers can't load — show the textbooks you've
  // downloaded instead, so the section never dead-ends.
  if (!online) return <OfflineSection section="textbooks" label="Textbooks" />

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Textbooks</h2>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}
      {data && data.configured === false && <NotConfigured />}

      {data && data.configured && data.count > 0 && (
        <>
          {/* Pinned shelf — only at the top level, so it doesn't crowd a deep view. */}
          {!path && !searching && (
            <PinnedShelf pins={pins} items={items} onUnpin={togglePin} />
          )}

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${data.count.toLocaleString()} textbooks…`}
            aria-label="Search textbooks"
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 placeholder-slate-500 outline-none focus:border-slate-500"
          />

          {searching ? (
            <SearchResults items={items} query={query} />
          ) : (
            <FolderView
              items={items}
              path={path}
              crumbs={crumbs}
              pinnedSet={pinnedSet}
              onTogglePin={togglePin}
            />
          )}
        </>
      )}
    </div>
  )
}

// Quick-access shortcuts to starred folders (newest first). Skips pins whose
// folder no longer exists (e.g. after a reorg) so there are no dead links.
function PinnedShelf({ pins, items, onUnpin }) {
  const navigate = useNavigate()
  const valid = pins.filter((p) => items.some((it) => it.id.startsWith(p.path + '/')))
  if (valid.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium uppercase tracking-wide text-slate-500">Pinned</h3>
      <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
        {valid.map((p) => {
          const { name, parent } = pinLabel(p.path)
          return (
            <li key={p.path} className="flex items-center">
              <button
                onClick={() => navigate(`/library/textbooks?path=${encodeURIComponent(p.path)}`)}
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left active:bg-slate-800"
              >
                <Star className="h-4 w-4 shrink-0 text-amber-400" fill="currentColor" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-slate-100">{name}</span>
                  {parent && <span className="block truncate text-xs text-slate-500">{parent}</span>}
                </span>
                <span className="shrink-0 text-slate-600">›</span>
              </button>
              <button
                onClick={() => onUnpin(p.path)}
                aria-label={`Unpin ${name}`}
                className="flex items-center px-3 py-3 text-slate-500 active:text-slate-300"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// Breadcrumb + the current folder's sub-folders (rows, each star-toggleable) and
// the books that live directly in it (cover grid).
function FolderView({ items, path, crumbs, pinnedSet, onTogglePin }) {
  const navigate = useNavigate()
  const { folders, issues } = browseFolder(items, path)

  return (
    <div className="space-y-5">
      {crumbs.length > 0 && (
        <nav className="flex flex-wrap items-center gap-1 text-sm text-slate-400">
          <Link to="/library/textbooks" className="hover:text-slate-200">
            Textbooks
          </Link>
          {crumbs.map((c) => (
            <span key={c.path}>
              <span className="px-1 text-slate-600">/</span>
              <Link to={`/library/textbooks?path=${encodeURIComponent(c.path)}`} className="hover:text-slate-200">
                {c.name}
              </Link>
            </span>
          ))}
        </nav>
      )}

      {folders.length > 0 && (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
          {folders.map((f) => {
            const pinned = pinnedSet.has(f.path)
            return (
              <li key={f.path} className="flex items-center">
                <button
                  onClick={() => navigate(`/library/textbooks?path=${encodeURIComponent(f.path)}`)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left active:bg-slate-800"
                >
                  <GraduationCap className="h-6 w-6 shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-100">{f.name}</span>
                    <span className="block text-xs text-slate-500">
                      {f.count} book{f.count === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="shrink-0 text-slate-600">›</span>
                </button>
                <button
                  onClick={() => onTogglePin(f.path)}
                  aria-label={pinned ? `Unpin ${f.name}` : `Pin ${f.name}`}
                  aria-pressed={pinned}
                  className={`flex items-center px-3 py-3 active:scale-90 ${
                    pinned ? 'text-amber-400' : 'text-slate-600'
                  }`}
                >
                  <Star className="h-5 w-5" fill={pinned ? 'currentColor' : 'none'} aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {issues.length > 0 && <BookGrid key={path} items={issues} />}
    </div>
  )
}

function SearchResults({ items, query }) {
  const results = searchItems(items, query)
  if (results.length === 0) {
    return <p className="text-sm text-slate-400">No textbooks match “{query.trim()}”.</p>
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">{results.length.toLocaleString()} match</p>
      <BookGrid key={query.trim()} items={results} />
    </div>
  )
}

// A cover grid that renders in pages — a folder/search with many titles would
// otherwise load every cover (and DOM node) at once.
function BookGrid({ items }) {
  const navigate = useNavigate()
  const downloaded = useDownloaded()
  const [shown, setShown] = useState(PAGE)
  const visible = items.slice(0, shown)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {visible.map((it) => (
          <button
            key={it.id}
            onClick={() => navigate(readerHref('textbooks', it))}
            className="group text-left active:opacity-80"
          >
            <span className="relative block">
              <BookCover
                book={it}
                src={textbookCoverUrl(it.id)}
                className="w-full rounded-lg transition-transform group-active:scale-95"
              />
              {downloaded?.has(downloadKey('textbooks', it.id)) && (
                <span className="absolute right-1 top-1">
                  <SavedBadge saved />
                </span>
              )}
            </span>
            <span className="mt-1 block truncate text-xs text-slate-300">{it.name}</span>
          </button>
        ))}
      </div>
      {shown < items.length && (
        <button
          onClick={() => setShown((n) => n + PAGE)}
          className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2.5 text-sm text-slate-200 active:bg-slate-800"
        >
          Load more ({(items.length - shown).toLocaleString()} left)
        </button>
      )}
    </div>
  )
}

function NotConfigured() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <p className="text-amber-400">No Textbooks folder configured.</p>
      <p className="mt-2 text-sm text-slate-400">
        Set <code className="rounded bg-slate-800 px-1">TEXTBOOKS_DIR</code> (a folder of
        reference/informational books, organized into sub-category folders, under your storage
        mount) in <code className="rounded bg-slate-800 px-1">.env</code>. See the Server Guide.
      </p>
    </div>
  )
}
