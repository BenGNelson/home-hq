import { useState, useEffect, useCallback } from 'react'
import { useApi, API_BASE } from '../../lib/useApi.js'
import { useCounterRate } from '../../lib/useRates.js'
import { Row, Bar, Spinner, OpenLink } from '../../components/ui.jsx'
import { Graph } from '../../components/Graph.jsx'
import { formatBytes, formatRate, formatUptime } from '../../lib/format.js'
import { containerUrl } from '../../lib/hostLocal.js'

function Dot({ ok }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${
        ok ? 'bg-emerald-500' : 'bg-slate-600'
      }`}
    />
  )
}

// The right-hand panel: live operational detail for the selected container.
// Polls so CPU/memory stay current. Shows only non-sensitive facts.
function ContainerDetail({ name }) {
  const { data, error, loading } = useApi(`/containers/${name}`, 5000)
  const net = useCounterRate(data?.net_rx_bytes, data?.net_tx_bytes, data?.time)

  if (error) return <p className="text-sm text-rose-400">unavailable — {error}</p>
  if (loading || !data) return <Spinner label="loading container…" />
  if (data.found === false) return <p className="text-sm text-slate-500">not found</p>

  const link = containerUrl(name)
  const healthColor =
    data.health === 'healthy'
      ? 'text-emerald-400'
      : data.health === 'unhealthy'
        ? 'text-rose-400'
        : 'text-slate-400'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Dot ok={data.status === 'running'} />
        <h3 className="text-base font-semibold">{data.name}</h3>
        {loading && <span className="text-xs text-slate-500">…</span>}
        <OpenLink href={link} className="ml-auto" />
      </div>

      <dl className="space-y-2 text-sm">
        <Row label="Image" value={<span className="truncate">{data.image}</span>} />
        <Row label="State" value={data.state ?? data.status} />
        {data.health && (
          <Row label="Health" value={<span className={healthColor}>{data.health}</span>} />
        )}
        <Row
          label="Uptime"
          value={data.uptime_seconds != null ? formatUptime(data.uptime_seconds) : '—'}
        />
        <Row label="Restarts" value={data.restart_count ?? '—'} />
        <Row label="Restart policy" value={data.restart_policy || 'none'} />
        <Row label="Networks" value={data.networks?.join(', ') || '—'} />
      </dl>

      {(data.cpu_percent != null || data.mem_percent != null) && (
        <div className="space-y-3 border-t border-slate-800 pt-3 text-sm">
          {data.cpu_percent != null && (
            <Bar label="CPU" percent={data.cpu_percent} caption={`${data.cpu_percent}%`} />
          )}
          {data.mem_percent != null && (
            <Bar
              label="Memory"
              percent={data.mem_percent}
              caption={`${formatBytes(data.mem_used_bytes)} (${data.mem_percent}%)`}
            />
          )}
        </div>
      )}

      {data.net_rx_bytes != null && (
        <div className="border-t border-slate-800 pt-3">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="uppercase tracking-wide text-slate-500">Network</span>
            <span className="flex gap-3 tabular-nums">
              <span className="text-emerald-400">↓ {formatRate(net.rxRate)}</span>
              <span className="text-sky-400">↑ {formatRate(net.txRate)}</span>
            </span>
          </div>
          <Graph
            formatValue={formatRate}
            legend={[
              { label: 'download', color: '#34d399' },
              { label: 'upload', color: '#38bdf8' },
            ]}
            caption="live"
            series={[
              { color: '#34d399', points: net.rx },
              { color: '#38bdf8', points: net.tx },
            ]}
          />
        </div>
      )}

      {data.ports?.length > 0 && (
        <div className="border-t border-slate-800 pt-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Ports</p>
          <ul className="space-y-1 text-sm text-slate-300">
            {data.ports.map((p) => (
              <li key={p} className="font-mono text-xs">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      <LogsSection name={name} />
    </div>
  )
}

// Collapsible recent-logs panel. Mounts (and only then fetches) on demand, so
// opening a container doesn't pull logs you didn't ask for. Manual refresh +
// tail-length control rather than auto-polling — logs are bulky.
function LogsSection({ name }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-slate-800 pt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-xs uppercase tracking-wide text-slate-500 transition hover:text-slate-300"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        Logs
      </button>
      {open && <ContainerLogs name={name} />}
    </div>
  )
}

const TAIL_OPTIONS = [100, 200, 500, 1000]

function ContainerLogs({ name }) {
  const [tail, setTail] = useState(200)
  const [state, setState] = useState({ loading: true, error: null, data: null })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      const res = await fetch(`${API_BASE}/containers/${name}/logs?tail=${tail}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setState({ loading: false, error: null, data: await res.json() })
    } catch (err) {
      setState({ loading: false, error: err.message, data: null })
    }
  }, [name, tail])

  useEffect(() => {
    load()
  }, [load])

  const { loading, error, data } = state
  const excluded = data && data.available === false && data.excluded
  const notFound = data && data.found === false
  const failed = data && data.available === false && !data.excluded
  const lines = data?.lines ?? []

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500">tail</span>
        <select
          value={tail}
          onChange={(e) => setTail(Number(e.target.value))}
          aria-label="Log lines to tail"
          className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-slate-300"
        >
          {TAIL_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          onClick={load}
          disabled={loading}
          className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? '…' : 'Refresh'}
        </button>
      </div>

      {excluded && <p className="text-xs text-amber-400">{data.reason}</p>}
      {notFound && <p className="text-xs text-slate-500">container not found</p>}
      {failed && <p className="text-xs text-rose-400">unavailable — {data.error}</p>}
      {error && <p className="text-xs text-rose-400">unavailable — {error}</p>}

      {data && data.available && (
        <pre className="max-h-96 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-300">
          {lines.length ? lines.join('\n') : <span className="text-slate-600">no log output</span>}
        </pre>
      )}
    </div>
  )
}

export default function Containers() {
  const { data, error } = useApi('/containers', 10000)
  const list = data?.containers ?? []
  const [selected, setSelected] = useState(null)

  // Default the selection to the first container once data arrives.
  const active = selected ?? list[0]?.name ?? null

  return (
    <div>
      {error ? (
        <p className="text-sm text-rose-400">unavailable — {error}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[18rem_1fr]">
          {/* List */}
          <ul className="self-start divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/50">
            {list.map((c) => (
              <li key={c.name}>
                <button
                  onClick={() => setSelected(c.name)}
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition ${
                    active === c.name ? 'bg-slate-800' : 'hover:bg-slate-800/50'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Dot ok={c.status === 'running'} />
                    <span className="truncate text-slate-200">{c.name}</span>
                    {containerUrl(c.name) && (
                      <span className="shrink-0 text-xs text-slate-500" title="has a web UI">
                        ↗
                      </span>
                    )}
                  </span>
                  <span className="ml-2 shrink-0 text-xs text-slate-400">
                    {c.status === 'running' ? formatUptime(c.uptime_seconds) : c.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* Detail */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            {active ? (
              <ContainerDetail key={active} name={active} />
            ) : (
              <p className="text-sm text-slate-500">loading…</p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
