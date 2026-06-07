import { useNetworkRates } from '../../lib/useRates.js'
import { Graph } from '../../components/Graph.jsx'
import { formatRate, formatClock } from '../../lib/format.js'

// Classify an interface by its (kernel-assigned) name into a friendly label and
// a generic description. Pattern-based so it stays host-agnostic — safe for git.
function describe(name) {
  if (name.startsWith('en') || name.startsWith('eth'))
    return {
      label: 'Wired Ethernet',
      desc: 'Primary wired connection — local network and internet traffic.',
    }
  if (name.startsWith('wl'))
    return { label: 'Wi-Fi', desc: 'Wireless network connection.' }
  if (name.startsWith('tailscale'))
    return {
      label: 'Tailscale VPN',
      desc: 'Encrypted remote-access traffic over the private mesh network.',
    }
  if (name.startsWith('wg'))
    return { label: 'WireGuard VPN', desc: 'Encrypted VPN tunnel traffic.' }
  return { label: name, desc: 'Network interface.' }
}

function TimeAxis({ times }) {
  if (times.length < 2) return <div className="mt-1 h-4" />
  const first = times[0]
  const mid = times[Math.floor(times.length / 2)]
  const last = times[times.length - 1]
  return (
    <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-500">
      <span>{formatClock(first)}</span>
      <span>{formatClock(mid)}</span>
      <span>{formatClock(last)} (now)</span>
    </div>
  )
}

export default function Network() {
  const { rates, times, error } = useNetworkRates(2000, 60)
  const names = Object.keys(rates)

  return (
    <div>
      <h2 className="mb-1 text-xl font-semibold">Network</h2>
      <p className="mb-4 text-xs text-slate-400">
        Live host throughput per interface · 2s samples, ~2 min window
      </p>

      {error ? (
        <p className="text-sm text-rose-400">unavailable — {error}</p>
      ) : names.length === 0 ? (
        <p className="text-sm text-slate-500">sampling…</p>
      ) : (
        <div className="space-y-4">
          {names.map((name) => {
            const r = rates[name]
            const { label, desc } = describe(name)
            const peak = Math.max(...r.rxHistory, ...r.txHistory, 1)
            return (
              <section
                key={name}
                className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"
              >
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-slate-200">{label}</h3>
                    <p className="text-xs text-slate-400">{desc}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-600">{name}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5 text-sm tabular-nums">
                    <span className="text-emerald-400">↓ {formatRate(r.rxRate)}</span>
                    <span className="text-sky-400">↑ {formatRate(r.txRate)}</span>
                  </div>
                </div>
                <Graph
                  heightClass="h-40"
                  series={[
                    { color: '#34d399', points: r.rxHistory },
                    { color: '#38bdf8', points: r.txHistory },
                  ]}
                />
                <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                  <span>peak {formatRate(peak)}</span>
                  <span className="flex gap-3">
                    <span className="text-emerald-400">↓ download</span>
                    <span className="text-sky-400">↑ upload</span>
                  </span>
                </div>
                <TimeAxis times={times} />
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
