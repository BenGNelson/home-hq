import { Sun, Zap, Home as HomeIcon } from 'lucide-react'
import { useApi } from '../../lib/useApi.js'
import { formatWatts, formatKwh, netLabel, solarUnavailableMessage } from '../../lib/solar.js'

// The Solar module: live Enphase production (and, on metered systems, whole-home
// consumption + net grid flow) read straight from the Envoy via the backend.
export default function Solar() {
  const { data, error, loading } = useApi('/solar', 10000)

  return (
    <div>
      {/* Title omitted — the shell's top bar already shows "Solar". */}
      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && data.available === false && <Unavailable reason={data.reason} />}
      {data && data.available && <Live d={data} />}
    </div>
  )
}

function Live({ d }) {
  const p = d.production
  const c = d.consumption
  const net = netLabel(d.net_watts)

  return (
    <div className="space-y-4">
      {/* Headline: current production */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-yellow-500/15 text-yellow-400">
            <Sun className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <div className="text-3xl font-semibold tabular-nums text-slate-100">
              {formatWatts(p?.watts_now)}
            </div>
            <div className="text-xs text-slate-400">producing now</div>
          </div>
          {net && <span className={`ml-auto text-sm font-medium ${net.tone}`}>{net.text}</span>}
        </div>
      </div>

      {/* Production energy totals */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Today" value={formatKwh(p?.watt_hours_today)} />
        <Stat label="Last 7 days" value={formatKwh(p?.watt_hours_last_7_days)} />
        <Stat label="Lifetime" value={formatKwh(p?.watt_hours_lifetime)} />
      </div>

      {/* Consumption — only on metered systems (CT clamps installed) */}
      {d.metered && c && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
            <HomeIcon className="h-4 w-4 text-cyan-400" aria-hidden="true" /> Home consumption
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Now" value={formatWatts(c.watts_now)} icon={<Zap className="h-4 w-4 text-cyan-400" aria-hidden="true" />} />
            <Stat label="Today" value={formatKwh(c.watt_hours_today)} />
            <Stat label="Lifetime" value={formatKwh(c.watt_hours_lifetime)} />
          </div>
        </div>
      )}

      {!d.metered && (
        <p className="text-xs text-slate-500">
          This system isn’t metered (no consumption CT clamps), so only production is reported.
        </p>
      )}
    </div>
  )
}

function Stat({ label, value, icon }) {
  return (
    <div className="rounded-lg bg-slate-800/40 p-3 text-center">
      <div className="flex items-center justify-center gap-1 text-lg font-semibold tabular-nums text-slate-100">
        {icon}
        {value}
      </div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  )
}

function Unavailable({ reason }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <p className="text-amber-400">{solarUnavailableMessage(reason)}</p>
      {reason === 'not_configured' && (
        <p className="mt-2 text-sm text-slate-400">
          Set{' '}
          <code className="rounded bg-slate-800 px-1">ENVOY_HOST</code>,{' '}
          <code className="rounded bg-slate-800 px-1">ENPHASE_USERNAME</code> and{' '}
          <code className="rounded bg-slate-800 px-1">ENPHASE_PASSWORD</code> in{' '}
          <code className="rounded bg-slate-800 px-1">.env</code> (your Enlighten login —
          the gateway’s token is minted and refreshed automatically) and restart the backend.
        </p>
      )}
      {reason === 'unreachable' && (
        <p className="mt-2 text-sm text-slate-400">
          The backend is configured but can’t reach the Envoy — check the gateway’s host/IP
          (and any router port-forward) and that your Enlighten credentials are valid.
        </p>
      )}
    </div>
  )
}
