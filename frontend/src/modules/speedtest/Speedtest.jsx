import { useState } from 'react'
import { ArrowDown, ArrowUp, Gauge } from 'lucide-react'
import { useApi, API_BASE } from '../../lib/useApi.js'
import { formatAgo } from '../../lib/format.js'
import { Graph } from '../../components/Graph.jsx'
import { formatMbps, formatPing } from '../../lib/speedtest.js'

// The Speedtest / ISP monitor: on-demand and scheduled internet speed tests
// (download / upload / ping) read from the backend, with a history chart. Poll
// every 5s so the running -> done transition and the new result show up live.
export default function Speedtest() {
  const { data, error, loading } = useApi('/speedtest', 5000)
  const [starting, setStarting] = useState(false)

  const running = Boolean(data?.running) || starting

  async function runTest() {
    setStarting(true)
    try {
      await fetch(`${API_BASE}/speedtest/run`, { method: 'POST' })
    } catch {
      /* the poll will surface the running flag / next result */
    } finally {
      // Hand off to the polled `running` flag; clearing the local flag once the
      // backend reports it has started avoids a stuck spinner if the POST 4xxs.
      setStarting(false)
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-xl font-semibold">Internet Speed</h2>
        <button
          onClick={runTest}
          disabled={running}
          className="ml-auto flex items-center gap-2 rounded-lg bg-fuchsia-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          )}
          {running ? 'Testing…' : 'Run test'}
        </button>
      </div>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && data.available === false && (
        <Unavailable reason={data.reason} running={running} onRun={runTest} />
      )}
      {data && data.available && <Live d={data} />}
    </div>
  )
}

function Live({ d }) {
  const l = d.latest

  return (
    <div className="space-y-4">
      {/* Headline stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          icon={<ArrowDown className="h-5 w-5" aria-hidden="true" />}
          accent="text-sky-400"
          label="Download"
          value={formatMbps(l?.download_mbps)}
        />
        <StatCard
          icon={<ArrowUp className="h-5 w-5" aria-hidden="true" />}
          accent="text-emerald-400"
          label="Upload"
          value={formatMbps(l?.upload_mbps)}
        />
        <StatCard
          icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
          accent="text-fuchsia-400"
          label="Ping"
          value={formatPing(l?.ping_ms)}
        />
      </div>

      <History history={d.history} stats={d.stats} />

      <Footer latest={l} />
    </div>
  )
}

function StatCard({ icon, accent, label, value }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span className={accent}>{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">{value}</div>
    </div>
  )
}

// Download (and upload) over time. `history` is oldest-first; map each sample's
// mbps to a points array the shared Graph expects ([{ color, points: [] }]).
function History({ history, stats }) {
  const samples = history ?? []
  const download = samples.map((h) => h.download_mbps ?? 0)
  const upload = samples.map((h) => h.upload_mbps ?? 0)

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300">History</h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-slate-400">
            <span className="inline-block h-1.5 w-3 rounded bg-sky-400" /> Download
          </span>
          <span className="flex items-center gap-1 text-slate-400">
            <span className="inline-block h-1.5 w-3 rounded bg-emerald-400" /> Upload
          </span>
        </div>
      </div>
      {samples.length < 2 ? (
        <p className="text-sm text-slate-500">
          Not enough samples yet — run a few tests and the trend fills in.
        </p>
      ) : (
        <Graph
          heightClass="h-24"
          height={96}
          unit="Mbps"
          times={samples.map((h) => h.ts * 1000)}
          series={[
            { color: '#38bdf8', points: download },
            { color: '#34d399', points: upload },
          ]}
        />
      )}
      {stats && stats.samples > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {stats.avg_download != null && (
            <span>avg ↓ {formatMbps(stats.avg_download)}</span>
          )}
          {stats.min_download != null && (
            <span>min ↓ {formatMbps(stats.min_download)}</span>
          )}
          {stats.avg_upload != null && <span>avg ↑ {formatMbps(stats.avg_upload)}</span>}
          <span>{stats.samples} samples</span>
        </div>
      )}
    </div>
  )
}

function Footer({ latest }) {
  if (!latest) return null
  const bits = []
  if (latest.server) bits.push(latest.server)
  if (latest.isp) bits.push(latest.isp)
  return (
    <p className="text-xs text-slate-500">
      {bits.join(' · ')}
      {bits.length > 0 && latest.ts ? ' · ' : ''}
      {latest.ts ? `tested ${formatAgo(latest.ts)}` : ''}
      {latest.result_url && (
        <>
          {' · '}
          <a
            href={latest.result_url}
            target="_blank"
            rel="noreferrer"
            className="text-fuchsia-400 hover:underline"
          >
            view result ↗
          </a>
        </>
      )}
    </p>
  )
}

function Unavailable({ reason, running, onRun }) {
  if (reason === 'not_enabled') {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <p className="text-sm text-slate-400">Speedtest is disabled.</p>
      </div>
    )
  }
  // no_data: enabled but no samples yet.
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <p className="text-sm text-slate-400">
        {running ? 'Testing… the first result will appear shortly.' : 'No tests yet — run one.'}
      </p>
      {!running && (
        <button
          onClick={onRun}
          className="mt-3 rounded-lg bg-fuchsia-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-fuchsia-500"
        >
          Run test
        </button>
      )}
    </div>
  )
}
