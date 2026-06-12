import { useApi } from '../../lib/useApi.js'
import { formatAgo } from '../../lib/format.js'
import { vpnVerdict, vpnExplanation } from '../../lib/vpn.js'

// VPN egress health: proves the protected container's traffic exits through the
// VPN (not the home connection) by comparing its public IP against the host's.
export default function Vpn() {
  const { data, error, loading } = useApi('/vpn', 10000)

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">VPN egress</h2>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && data.available === false && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <p className="text-amber-400">No VPN egress data yet.</p>
          <p className="mt-2 text-sm text-slate-400">
            The host check (<code className="rounded bg-slate-800 px-1">scripts/vpn-health.py</code>,
            run by a systemd timer) hasn’t written its state file yet. See the Server
            Guide for installing the timer.
          </p>
        </div>
      )}

      {data && data.available && <Detail v={data} />}
    </div>
  )
}

const TONE = {
  good: 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300',
  bad: 'border-rose-700/60 bg-rose-950/40 text-rose-200',
  idle: 'border-slate-700/50 bg-slate-800/30 text-slate-300',
}

function Detail({ v }) {
  const verdict = vpnVerdict(v)
  return (
    <>
      {/* Headline verdict */}
      <div className={`rounded-xl border p-5 ${TONE[verdict.tone]}`}>
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none">
            {verdict.tone === 'good' ? '🔒' : verdict.tone === 'bad' ? '⚠️' : '○'}
          </span>
          <span className="text-lg font-semibold">{verdict.label}</span>
          {v.stale && (
            <span className="ml-auto rounded bg-slate-800 px-2 py-0.5 text-xs text-amber-300">
              stale
            </span>
          )}
        </div>
        <p className="mt-2 text-sm opacity-90">{vpnExplanation(v)}</p>
      </div>

      {/* Exit vs home comparison */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Endpoint
          title="VPN exit"
          subtitle="where the protected traffic appears to come from"
          ip={v.vpn}
          accent={!v.leak}
        />
        <Endpoint
          title="Your home IP"
          subtitle="your real connection — should differ from the exit"
          ip={v.home}
          accent={false}
        />
      </div>

      {/* Facts */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Fact label="Container" value={v.container || '—'} />
          <Fact label="Running" value={v.container_running ? 'yes' : 'no'} />
          <Fact label="Forwarded port" value={v.forwarded_port ?? '—'} />
          <Fact label="Checked" value={v.updated ? formatAgo(v.updated) : '—'} />
        </dl>
      </div>
    </>
  )
}

function Endpoint({ title, subtitle, ip, accent }) {
  const loc = ip ? [ip.city, ip.region, ip.country].filter(Boolean).join(', ') : null
  return (
    <div
      className={`rounded-xl border bg-slate-900/50 p-4 ${
        accent ? 'border-emerald-800/50' : 'border-slate-800'
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-slate-400">{title}</div>
      <div className="mt-1 font-mono text-lg text-slate-100">{ip?.ip || '—'}</div>
      <div className="mt-1 text-sm text-slate-300">{ip?.org || '—'}</div>
      {loc && <div className="text-xs text-slate-500">{loc}</div>}
      <div className="mt-2 text-xs text-slate-600">{subtitle}</div>
    </div>
  )
}

function Fact({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-slate-200 tabular-nums">{value}</dd>
    </div>
  )
}
