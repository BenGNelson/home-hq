import { useState } from 'react'
import { ArrowDown, ArrowUp, Gauge } from 'lucide-react'
import { useApi, API_BASE } from '../../lib/useApi.js'
import { formatAgo } from '../../lib/format.js'
import { Graph } from '../../components/Graph.jsx'
import {
  formatMbps,
  formatPing,
  SPEEDTEST_RANGES,
  DEFAULT_SPEEDTEST_RANGE,
} from '../../lib/speedtest.js'

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
      {/* No page title — the shell's top bar already shows "Speed". */}
      <div className="mb-4 flex items-center gap-3">
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

      <HistorySection latestTs={l?.ts} />

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

const LEGEND = [
  { label: 'Download', color: '#38bdf8' },
  { label: 'Upload', color: '#34d399' },
]

// Download/upload over a selectable time window — the "running score" view. Owns
// its own fetch of /speedtest/history?range= (the backend downsamples long ranges
// to a chart-friendly point count) so switching range doesn't touch the 5s latest
// poll. Polls slowly (new samples only land every few hours) but folds the latest
// sample's ts into the path, so a just-finished "Run test" — picked up by the
// page's 5s latest poll — refetches the trend at once instead of lagging a minute.
function HistorySection({ latestTs }) {
  const [range, setRange] = useState(DEFAULT_SPEEDTEST_RANGE)
  const bust = latestTs ? `&t=${latestTs}` : '' // backend ignores the extra param
  const { data, error, loading } = useApi(`/speedtest/history?range=${range}${bust}`, 60000)

  const samples = data?.points ?? []
  const stats = data?.stats
  const download = samples.map((h) => h.download_mbps ?? 0)
  const upload = samples.map((h) => h.upload_mbps ?? 0)

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-300">History</h3>
        <div className="flex gap-1" role="group" aria-label="History range">
          {SPEEDTEST_RANGES.map((r) => {
            const active = r.key === range
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                aria-pressed={active}
                className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                  active
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {r.label}
              </button>
            )
          })}
        </div>
      </div>
      {error && !data ? (
        <p className="text-sm text-rose-400">unavailable — {error}</p>
      ) : samples.length < 2 ? (
        <p className="text-sm text-slate-500">
          {loading && !data
            ? 'loading…'
            : 'Not enough samples in this range yet — the trend fills in as tests run.'}
        </p>
      ) : (
        <Graph
          heightClass="h-32"
          height={128}
          unit="Mbps"
          legend={LEGEND}
          times={samples.map((h) => h.ts * 1000)}
          series={[
            { color: '#38bdf8', points: download },
            { color: '#34d399', points: upload },
          ]}
        />
      )}
      {stats && stats.samples > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {stats.avg_download != null && <span>avg ↓ {formatMbps(stats.avg_download)}</span>}
          {stats.min_download != null && <span>min ↓ {formatMbps(stats.min_download)}</span>}
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
        <p className="text-sm text-amber-400">Speedtest is disabled.</p>
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
