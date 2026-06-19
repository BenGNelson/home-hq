import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useApi } from '../../lib/useApi.js'
import { readerHref, groupBySeries } from '../../lib/library.js'
import ComicCover from './ComicCover.jsx'

// The Comics section. A large library lives in per-series folders, so the top
// level lists series (cheap text rows) + any loose "singles"; tapping a series
// (?series=) shows that series' issues as a cover grid, each opening in the
// page-by-page comic reader. Mobile-first; the ?series param gives real history
// so the back gesture returns to the series list.
export default function ComicsList() {
  const { data, error, loading } = useApi('/library/comics', 30000)
  const [params] = useSearchParams()
  const series = params.get('series')

  return (
    <div className="space-y-5">
      <Link
        to={series ? '/library/comics' : '/library'}
        className="text-sm text-slate-400 hover:text-slate-200"
      >
        ← {series ? 'Comics' : 'Library'}
      </Link>
      <h2 className="text-xl font-semibold">{series || 'Comics'}</h2>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}
      {data && data.configured === false && <NotConfigured />}
      {data && data.configured && data.count === 0 && (
        <p className="text-sm text-slate-400">Nothing here yet — drop some CBZ/CBR files in the folder.</p>
      )}

      {data && data.count > 0 && (series ? <SeriesIssues data={data} series={series} /> : <Browse data={data} />)}
    </div>
  )
}

// Top level: a list of series folders + a grid of loose singles.
function Browse({ data }) {
  const navigate = useNavigate()
  const { series, singles } = groupBySeries(data.items)
  return (
    <div className="space-y-6">
      {series.length > 0 && (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
          {series.map(([name, items]) => (
            <li key={name}>
              <button
                onClick={() => navigate(`/library/comics?series=${encodeURIComponent(name)}`)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-800"
              >
                <span className="text-xl">🦸</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-slate-100">{name}</span>
                  <span className="block text-xs text-slate-500">
                    {items.length} issue{items.length === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="shrink-0 text-slate-600">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {singles.length > 0 && <IssueGrid items={singles} />}
    </div>
  )
}

// One series' issues as a cover grid.
function SeriesIssues({ data, series }) {
  const items = data.items.filter((it) => {
    const slash = it.id.indexOf('/')
    return slash !== -1 && it.id.slice(0, slash) === series
  })
  return <IssueGrid items={items} stripPrefix={series} />
}

function IssueGrid({ items, stripPrefix }) {
  const navigate = useNavigate()
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {items.map((it) => {
        // Within a series the folder name is redundant in each title.
        let title = it.name
        if (stripPrefix && title.startsWith(stripPrefix)) {
          title = title.slice(stripPrefix.length).replace(/^[\s\-:]+/, '') || it.name
        }
        return (
          <button
            key={it.id}
            onClick={() => navigate(readerHref('comics', it))}
            className="group text-left active:opacity-80"
          >
            <ComicCover comic={it} className="w-full rounded-lg transition-transform group-active:scale-95" />
            <span className="mt-1 block truncate text-xs text-slate-300">{title}</span>
          </button>
        )
      })}
    </div>
  )
}

function NotConfigured() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <p className="text-amber-400">No Comics folder configured.</p>
      <p className="mt-2 text-sm text-slate-400">
        Set <code className="rounded bg-slate-800 px-1">COMICS_DIR</code> (a folder of CBZ/CBR/CB7
        files under your storage mount) in <code className="rounded bg-slate-800 px-1">.env</code>.
        See the Server Guide.
      </p>
    </div>
  )
}
