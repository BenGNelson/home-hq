import { Link } from 'react-router-dom'
import { useApi } from '../lib/useApi.js'

// A row of pills for quick switching between Plex libraries from any sub-page.
// Doubles as a breadcrumb: the active pill (activeKey) shows which library you
// are in — on a show/movie detail page that's the parent library.
export default function LibraryNav({ activeKey }) {
  const libs = useApi('/plex/libraries', 60000)
  const libraries = [...(libs.data?.libraries ?? [])]
    .filter((l) => l.type === 'movie' || l.type === 'show')
    .sort((a, b) => a.title.localeCompare(b.title))

  const pill = 'rounded-full px-3 py-1 text-xs font-medium transition whitespace-nowrap'
  const inactive = `${pill} border border-slate-700 text-slate-300 hover:bg-slate-800`

  return (
    <nav className="mb-4 flex flex-wrap items-center gap-2">
      {/* A back/up action, not a filter — arrow + divider set it apart. */}
      <Link
        to="/plex"
        className={`${pill} flex items-center gap-1 text-slate-400 hover:text-slate-200`}
      >
        <span aria-hidden>←</span> Overview
      </Link>
      <span className="mr-1 h-4 w-px bg-slate-700" aria-hidden />
      {libraries.map((l) => (
        <Link
          key={l.key}
          to={`/plex/library/${l.key}`}
          className={l.key === activeKey ? `${pill} bg-emerald-600 text-white` : inactive}
        >
          {l.title}
        </Link>
      ))}
    </nav>
  )
}
