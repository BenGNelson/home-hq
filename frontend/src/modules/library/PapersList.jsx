import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Newspaper, FileText } from 'lucide-react'
import { useApi } from '../../lib/useApi.js'
import { useOnline } from '../../lib/online.jsx'
import { useDownloaded } from '../../lib/useDownloaded.js'
import { downloadKey } from '../../lib/offlineStore.js'
import { formatSize } from '../../lib/format.js'
import { readerHref, browseFolder, searchItems, folderCrumbs } from '../../lib/library.js'
import OfflineSection from './OfflineSection.jsx'
import SavedBadge from './SavedBadge.jsx'

// The Magazines & Papers section: a folder browser that mirrors the library on
// disk at any nesting depth, so a series with many issues (e.g. every National
// Geographic) lives behind one series row instead of flooding the list. Drop a
// series' PDFs in a subfolder under PAPERS_DIR and it shows up as a series →
// drill in for its issues. A flat folder still just lists its PDFs (no folders),
// so this is backward-compatible and user-controlled. A search box spans every
// paper. The current folder lives in ?path= so the back gesture walks up the tree.
// Plain rows (PDFs have no cheap cover render) — mobile-first, big tap targets.
export default function PapersList() {
  const { data, error, loading } = useApi('/library/papers', 30000)
  const { online } = useOnline()
  const [params] = useSearchParams()
  const path = params.get('path') || ''
  const [query, setQuery] = useState('')

  // Offline the live list can't load — show the downloaded papers instead so the
  // section never dead-ends (e.g. closing a reader back onto this page).
  if (!online) return <OfflineSection section="papers" label="Magazines & Papers" />

  const items = data?.items ?? []
  const crumbs = folderCrumbs(path)
  const searching = query.trim().length > 0

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Magazines &amp; Papers</h2>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}
      {data && data.configured === false && <NotConfigured />}
      {data && data.configured && data.count === 0 && (
        <p className="text-sm text-slate-400">Nothing here yet — drop some PDFs in the folder.</p>
      )}

      {data && data.configured && data.count > 0 && (
        <>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${data.count.toLocaleString()} papers…`}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 placeholder-slate-500 outline-none focus:border-slate-500"
          />

          {searching ? (
            <SearchResults items={items} query={query} />
          ) : (
            <FolderView items={items} path={path} crumbs={crumbs} />
          )}
        </>
      )}
    </div>
  )
}

// Breadcrumb + the current folder's subfolders (series rows) and the papers that
// live directly in it (reader rows).
function FolderView({ items, path, crumbs }) {
  const navigate = useNavigate()
  const { folders, issues } = browseFolder(items, path)

  return (
    <div className="space-y-5">
      {crumbs.length > 0 && (
        <nav className="flex flex-wrap items-center gap-1 text-sm text-slate-400">
          <Link to="/library/papers" className="hover:text-slate-200">
            Papers
          </Link>
          {crumbs.map((c) => (
            <span key={c.path}>
              <span className="px-1 text-slate-600">/</span>
              <Link
                to={`/library/papers?path=${encodeURIComponent(c.path)}`}
                className="hover:text-slate-200"
              >
                {c.name}
              </Link>
            </span>
          ))}
        </nav>
      )}

      {folders.length > 0 && (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
          {folders.map((f) => (
            <li key={f.path}>
              <button
                onClick={() => navigate(`/library/papers?path=${encodeURIComponent(f.path)}`)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-800"
              >
                <Newspaper className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-slate-100">{f.name}</span>
                  <span className="block text-xs text-slate-500">
                    {f.count} issue{f.count === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="shrink-0 text-slate-600">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {issues.length > 0 && <PaperRows items={issues} />}
    </div>
  )
}

function SearchResults({ items, query }) {
  const results = searchItems(items, query)
  if (results.length === 0) {
    return <p className="text-sm text-slate-400">No papers match “{query.trim()}”.</p>
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">{results.length.toLocaleString()} match</p>
      <PaperRows items={results} />
    </div>
  )
}

// The tappable PDF rows — each opens in the in-app reader. A "✓ offline" badge
// marks rows you've already downloaded.
function PaperRows({ items }) {
  const navigate = useNavigate()
  const downloaded = useDownloaded()
  return (
    <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
      {items.map((it) => (
        <li key={it.id}>
          <button
            onClick={() => navigate(readerHref('papers', it))}
            className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-800"
          >
            <FileText className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-slate-100">{it.name}</span>
              {it.size != null && (
                <span className="block text-xs text-slate-500">{formatSize(it.size)}</span>
              )}
            </span>
            <SavedBadge saved={downloaded?.has(downloadKey('papers', it.id))} />
            <span className="shrink-0 text-slate-600">›</span>
          </button>
        </li>
      ))}
    </ul>
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
