import { Link } from 'react-router-dom'
import { useApi } from '../../lib/useApi.js'
import { libraryHeadline } from '../../lib/library.js'

// The Library hub: your owned content (games now; comics/books/papers later),
// played/read in-app. Mobile-first — big tap-target section cards that drill
// into a section's browse page. Each section self-describes (configured + count)
// so unconfigured ones show a hint instead of vanishing.
export default function Library() {
  const { data, error, loading } = useApi('/library', 30000)

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Library</h2>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && (
        <>
          <p className="text-sm text-slate-400">{libraryHeadline(data)}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.sections.map((s) => (
              <SectionCard key={s.key} s={s} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function SectionCard({ s }) {
  const enabled = s.configured && s.count > 0
  const sub = !s.configured
    ? 'not set up yet'
    : s.count === 0
      ? 'empty'
      : `${s.count} item${s.count === 1 ? '' : 's'}`

  const inner = (
    <div
      className={`flex items-center gap-4 rounded-2xl border p-5 transition-colors ${
        enabled
          ? 'border-slate-700 bg-slate-900/60 active:bg-slate-800'
          : 'border-slate-800 bg-slate-900/30'
      }`}
    >
      <span className="text-3xl">{s.icon}</span>
      <div className="min-w-0">
        <div className="font-medium text-slate-100">{s.label}</div>
        <div className="text-sm text-slate-400">{sub}</div>
      </div>
    </div>
  )

  return enabled ? (
    <Link to={`/library/${s.key}`} className="block">
      {inner}
    </Link>
  ) : (
    <div className="block cursor-default opacity-70" title="Not configured">
      {inner}
    </div>
  )
}
