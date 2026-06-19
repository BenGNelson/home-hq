import { useApi } from '../../lib/useApi.js'
import { formatAgo } from '../../lib/format.js'
import { tailscaleVerdict, tailscaleExplanation, osIcon } from '../../lib/tailscale.js'

// Tailscale mesh status: this host plus every other device on the tailnet, with
// online state, exit-node role, and last-seen — read from a host-collected
// snapshot (the backend container can't run `tailscale` itself).
export default function Tailscale() {
  const { data, error, loading } = useApi('/tailscale', 10000)

  return (
    <div className="space-y-4">

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && data.available === false && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <p className="text-amber-400">No Tailscale data yet.</p>
          <p className="mt-2 text-sm text-slate-400">
            The host check (<code className="rounded bg-slate-800 px-1">scripts/tailscale-status.py</code>,
            run by a systemd timer) hasn’t written its state file yet. See the
            Server Guide for installing the timer.
          </p>
        </div>
      )}

      {data && data.available && <Detail t={data} />}
    </div>
  )
}

const TONE = {
  good: 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300',
  bad: 'border-rose-700/60 bg-rose-950/40 text-rose-200',
  idle: 'border-slate-700/50 bg-slate-800/30 text-slate-300',
}

function Detail({ t }) {
  const verdict = tailscaleVerdict(t)
  const devices = [t.self, ...(t.peers || [])].filter(Boolean)
  return (
    <>
      {/* Headline verdict */}
      <div className={`rounded-xl border p-5 ${TONE[verdict.tone]}`}>
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none">
            {verdict.tone === 'good' ? '🔗' : verdict.tone === 'bad' ? '⚠️' : '○'}
          </span>
          <span className="text-lg font-semibold">{verdict.label}</span>
          {t.stale && (
            <span className="ml-auto rounded bg-slate-800 px-2 py-0.5 text-xs text-amber-300">
              stale
            </span>
          )}
        </div>
        <p className="mt-2 text-sm opacity-90">{tailscaleExplanation(t)}</p>
      </div>

      {/* Tailnet facts */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Fact label="Tailnet" value={t.tailnet || '—'} />
          <Fact label="MagicDNS" value={t.magicdns ? 'on' : 'off'} />
          <Fact label="Devices online" value={`${t.online_total ?? t.online_count} / ${t.peer_count + (t.self ? 1 : 0)}`} />
          <Fact label="Exit node" value={t.exit_node || 'none'} />
        </dl>
      </div>

      {/* Device list */}
      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/70 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-2 font-medium">Device</th>
              <th className="px-4 py-2 font-medium">Tailscale IP</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {devices.map((d) => (
              <Row key={d.dns_name || d.hostname} d={d} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Row({ d }) {
  return (
    <tr className="bg-slate-900/40">
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{osIcon(d.os)}</span>
          <span className="font-medium text-slate-100">{d.hostname}</span>
          {d.self && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">
              this host
            </span>
          )}
          {d.exit_node && (
            <span className="rounded bg-sky-900/60 px-1.5 py-0.5 text-[10px] uppercase text-sky-300">
              exit node
            </span>
          )}
          {!d.exit_node && d.exit_node_option && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
              offers exit
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-2 font-mono text-slate-300">{d.ip || '—'}</td>
      <td className="px-4 py-2">
        {d.online ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> online
          </span>
        ) : (
          <span className="text-slate-500">
            offline{d.last_seen ? ` · seen ${formatAgo(d.last_seen)}` : ''}
          </span>
        )}
      </td>
    </tr>
  )
}

function Fact({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="truncate text-slate-200 tabular-nums">{value}</dd>
    </div>
  )
}
