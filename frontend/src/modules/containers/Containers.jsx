import { useState } from 'react'
import { useApi } from '../../lib/useApi.js'
import { useCounterRate } from '../../lib/useRates.js'
import { Row, Bar, Spinner } from '../../components/ui.jsx'
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
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="ml-auto rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-emerald-400 transition hover:bg-slate-800"
          >
            Open ↗
          </a>
        )}
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
      <h2 className="mb-4 text-xl font-semibold">Containers</h2>
      {error ? (
        <p className="text-sm text-rose-400">unavailable — {error}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[18rem_1fr]">
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
