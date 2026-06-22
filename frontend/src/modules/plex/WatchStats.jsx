import { useState } from 'react'
import { useApi } from '../../lib/useApi.js'
import BackLink from '../../components/BackLink.jsx'
import { Donut } from '../../components/Donut.jsx'

// Plex watch stats: who watched what, over week / month / year / all-time.
// Computed live from Plex's own view history (the endpoint returns all four
// periods at once, so switching is instant — no refetch).
const PERIODS = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
  { key: 'all', label: 'All time' },
]

// Distinct, theme-friendly palette (Tailwind *-400 hexes) cycled per viewer.
const USER_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#22d3ee', '#fb923c', '#a3e635', '#e879f9', '#2dd4bf']
const TYPE_COLORS = { movie: '#38bdf8', episode: '#a78bfa' }
const OTHER_COLOR = '#94a3b8'

const fmtHours = (h) => (h == null ? '—' : `${h.toFixed(1)} h`)
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

export default function WatchStats() {
  const [period, setPeriod] = useState('all')
  const [metric, setMetric] = useState('plays') // plays | hours
  const { data, error, loading } = useApi('/plex/watch-stats', 300000)

  return (
    <div className="space-y-4">
      <BackLink to="/plex">Plex</BackLink>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">Watch Stats</h2>
        <div className="ml-auto flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                period === p.key
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-800/40 text-slate-400 hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}
      {data && data.available === false && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <p className="text-amber-400">
            {data.reason === 'not_configured'
              ? 'Plex isn’t configured.'
              : 'Can’t reach Plex right now.'}
          </p>
        </div>
      )}

      {data && data.available && <Stats p={data.periods[period]} metric={metric} setMetric={setMetric} />}
    </div>
  )
}

function Stats({ p, metric, setMetric }) {
  if (!p || p.total_plays === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
        No plays in this period yet.
      </div>
    )
  }

  const userSegments = p.by_user.map((u, i) => ({
    label: u.user,
    value: metric === 'hours' ? u.hours : u.plays,
    color: USER_COLORS[i % USER_COLORS.length],
  }))
  const typeSegments = Object.entries(p.by_type).map(([type, count]) => ({
    label: cap(type),
    value: count,
    color: TYPE_COLORS[type] || OTHER_COLOR,
  }))

  const centerTotal =
    metric === 'hours'
      ? { big: p.total_hours.toFixed(0), small: 'hours' }
      : { big: p.total_plays, small: 'plays' }

  return (
    <div className="space-y-4">
      {/* Two donuts: by viewer (plays|hours toggle) + by content type */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center gap-3">
            <h3 className="text-sm font-medium text-slate-300">By viewer</h3>
            <div className="ml-auto flex gap-1">
              {['plays', 'hours'].map((m) => (
                <button
                  key={m}
                  onClick={() => setMetric(m)}
                  className={`rounded-md px-2 py-0.5 text-xs font-medium transition ${
                    metric === m
                      ? 'bg-slate-700 text-white'
                      : 'bg-slate-800/40 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cap(m)}
                </button>
              ))}
            </div>
          </div>
          <Donut
            segments={userSegments}
            size={180}
            thickness={30}
            centerLabel={
              <div>
                <div className="text-2xl font-semibold text-slate-100">{centerTotal.big}</div>
                <div className="text-xs text-slate-400">{centerTotal.small}</div>
              </div>
            }
          />
        </Card>

        <Card>
          <h3 className="mb-3 text-sm font-medium text-slate-300">By type</h3>
          <Donut
            segments={typeSegments}
            size={180}
            thickness={30}
            centerLabel={
              <div>
                <div className="text-2xl font-semibold text-slate-100">{p.total_plays}</div>
                <div className="text-xs text-slate-400">plays</div>
              </div>
            }
          />
        </Card>
      </div>

      {/* Leaderboard: plays + hours per viewer */}
      <Card>
        <h3 className="mb-3 text-sm font-medium text-slate-300">Leaderboard</h3>
        <ul className="space-y-1 text-sm">
          {p.by_user.map((u, i) => (
            <li key={u.user} className="flex items-center gap-3 border-b border-slate-800/60 py-1.5 last:border-0">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: USER_COLORS[i % USER_COLORS.length] }}
              />
              <span className="min-w-0 flex-1 truncate text-slate-200">{u.user}</span>
              <span className="shrink-0 tabular-nums text-slate-300">{u.plays} plays</span>
              <span className="w-20 shrink-0 text-right tabular-nums text-slate-500">{fmtHours(u.hours)}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Most-watched titles */}
      {p.top?.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-medium text-slate-300">Most watched</h3>
          <ul className="space-y-1 text-sm">
            {p.top.map((t, i) => (
              <li key={`${t.title}-${i}`} className="flex items-center gap-3 py-1">
                <span className="w-5 shrink-0 text-right tabular-nums text-slate-500">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-slate-200" title={t.title}>
                  {t.title}
                </span>
                <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
                  {t.type}
                </span>
                <span className="shrink-0 tabular-nums text-slate-400">{t.plays}×</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function Card({ children }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">{children}</div>
}
