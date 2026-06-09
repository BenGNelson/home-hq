import { useApi } from '../../lib/useApi.js'

// One pill per subsystem, ordered most-to-least critical.
const ITEMS = [
  ['system', 'System'],
  ['storage', 'Storage'],
  ['drives', 'Drives'],
  ['plex', 'Plex'],
  ['containers', 'Containers'],
]

const DOT = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  down: 'bg-rose-500',
  unknown: 'bg-slate-600',
}

// An at-a-glance health strip above the dashboard widgets: a colored dot +
// short detail per subsystem, so "all good" (or the one thing that isn't) reads
// instantly without scanning every card. One /summary call feeds it.
export default function HealthBar() {
  const { data } = useApi('/summary', 15000)
  if (!data) return null

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {ITEMS.map(([key, label]) => {
        const s = data[key] || { status: 'unknown', detail: '' }
        return (
          <div
            key={key}
            className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5"
            title={`${label}: ${s.status}`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[s.status] || DOT.unknown}`} />
            <span className="text-sm text-slate-300">{label}</span>
            {s.detail && <span className="text-xs text-slate-500">{s.detail}</span>}
          </div>
        )
      })}
    </div>
  )
}
