import { useState } from 'react'
import { useApi } from '../../lib/useApi.js'
import BackLink from '../../components/BackLink.jsx'
import { Graph } from '../../components/Graph.jsx'
import { formatHour, formatShare, formatMbps } from '../../lib/plexInsights.js'

// Plex insights: activity trends over time (concurrent streams, transcode load,
// reserved bandwidth) sampled every few minutes by the in-app sampler, plus
// headline stats. Empty until the sampler has been running for a while.
const WINDOWS = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
]

export default function Insights() {
  const [hours, setHours] = useState(24)
  const { data, error, loading } = useApi(`/plex/insights?hours=${hours}`, 30000)

  return (
    <div className="space-y-4">
      <BackLink to="/plex">Plex</BackLink>
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">Plex Insights</h2>
        <div className="ml-auto flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.hours}
              onClick={() => setHours(w.hours)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                hours === w.hours
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-800/40 text-slate-400 hover:text-slate-200'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && <Body data={data} />}
    </div>
  )
}

function Body({ data }) {
  const { samples, stats } = data
  if (!samples || samples.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
        No activity recorded for this window yet. The sampler logs Plex activity
        every few minutes while the server is reachable — trends fill in over time.
      </div>
    )
  }

  const streams = samples.map((s) => s.streams)
  const transcodes = samples.map((s) => s.transcodes)
  const bandwidth = samples.map((s) => s.bandwidth_kbps || 0)

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Peak streams" value={stats.peak_streams} />
        <Stat label="Stream-hours" value={stats.stream_hours} />
        <Stat label="Active time" value={formatShare(stats.active_share)} />
        <Stat label="Transcoded" value={formatShare(stats.transcode_share)} />
        <Stat label="Peak bandwidth" value={formatMbps(stats.peak_bandwidth_kbps)} />
        <Stat label="Busiest hour" value={formatHour(stats.busiest_hour)} />
      </div>

      <Trend title="Concurrent streams" color="#34d399" points={streams} />
      <Trend title="Transcodes" color="#fbbf24" points={transcodes} />
      <Trend title="Reserved bandwidth (kbps)" color="#38bdf8" points={bandwidth} />
    </>
  )
}

function Trend({ title, color, points }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <h3 className="mb-2 text-sm font-medium text-slate-300">{title}</h3>
      <Graph series={[{ color, points }]} heightClass="h-20" height={80} />
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-800/40 p-3">
      <div className="text-lg font-semibold text-slate-100 tabular-nums">{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  )
}
