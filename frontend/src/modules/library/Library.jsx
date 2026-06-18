import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApi, API_BASE } from '../../lib/useApi.js'
import { libraryHeadline } from '../../lib/library.js'
import { progressLabel, progressFraction } from '../../lib/reading.js'

// The Library hub: your owned content (games now; comics/books/papers later),
// played/read in-app. Mobile-first — big tap-target section cards that drill
// into a section's browse page. Each section self-describes (configured + count)
// so unconfigured ones show a hint instead of vanishing. A "Continue reading"
// shelf at the top jumps back into in-progress documents.
export default function Library() {
  const { data, error, loading } = useApi('/library', 30000)

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Library</h2>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      <ContinueReading />

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

// In-progress documents, newest first — resume where you left off, or remove an
// item from the shelf (clears its server-side bookmark). Hidden when empty.
function ContinueReading() {
  const navigate = useNavigate()
  const { data } = useApi('/library/reading-progress', 30000)
  const [removed, setRemoved] = useState(() => new Set())

  const items = (data?.items ?? []).filter((it) => !removed.has(`${it.section}:${it.id}`))
  if (items.length === 0) return null

  const remove = (it) => {
    const key = `${it.section}:${it.id}`
    setRemoved((prev) => new Set(prev).add(key)) // optimistic
    fetch(
      `${API_BASE}/library/reading-progress?section=${encodeURIComponent(
        it.section
      )}&id=${encodeURIComponent(it.id)}`,
      { method: 'DELETE' }
    ).catch(() => {})
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium uppercase tracking-wide text-slate-500">Continue reading</h3>
      <div className="space-y-2">
        {items.map((it) => (
          <div
            key={`${it.section}:${it.id}`}
            className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3"
          >
            <button
              onClick={() => navigate(`/library/read?section=${it.section}&id=${encodeURIComponent(it.id)}`)}
              className="min-w-0 flex-1 text-left active:opacity-80"
            >
              <span className="block truncate text-slate-100">{it.name}</span>
              <span className="mt-1 block text-xs text-slate-400">{progressLabel(it.page, it.total)}</span>
              <span className="mt-1.5 block h-1 overflow-hidden rounded bg-slate-800">
                <span
                  className="block h-full bg-sky-500"
                  style={{ width: `${Math.round(progressFraction(it.page, it.total) * 100)}%` }}
                />
              </span>
            </button>
            <button
              onClick={() => remove(it)}
              aria-label="Remove from Continue reading"
              className="shrink-0 rounded-full px-2 py-1 text-slate-500 active:bg-slate-800 active:text-slate-300"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </section>
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
