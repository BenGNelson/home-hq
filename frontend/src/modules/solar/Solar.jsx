import { useApi } from '../../lib/useApi.js'
import { Graph } from '../../components/Graph.jsx'
import { SolarGauge } from '../../components/SolarGauge.jsx'
import { SolarFlow } from '../../components/SolarFlow.jsx'
import {
  formatWatts,
  formatKwh,
  netLabel,
  solarUnavailableMessage,
  gaugeFraction,
  glowIntensity,
  flowModel,
  barPair,
} from '../../lib/solar.js'

// The Solar module: live Enphase production (and, on metered systems, whole-home
// consumption + net grid flow) read straight from the Envoy via the backend. The
// visual language is energy motion + radiance — a glowing production gauge beside
// an animated power-flow diagram, warm gold/cyan/emerald — distinct from the
// Weather module's temperature ramp.
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
  // The intraday trend comes from the in-app sampler — polled slower than the
  // live snapshot (it only changes every few minutes).
  const { data: hist } = useApi('/solar/history?hours=24', 60000)

  const p = d.production
  const c = d.consumption
  const net = netLabel(d.net_watts)
  const model = flowModel(p, c, d.net_watts, d.metered)

  // Scale the gauge against the best production seen (today's peak), so the dial
  // reads relative to this system's own output rather than a guessed capacity.
  const refPeak = Math.max(hist?.stats?.peak_watts || 0, p?.watts_now || 0, 1000)
  const frac = gaugeFraction(p?.watts_now, refPeak)
  const glow = glowIntensity(p?.watts_now, refPeak)

  const samples = hist?.samples || []
  const series = [{ color: '#f59e0b', points: samples.map((s) => s.prod_watts ?? 0) }]
  if (d.metered) series.push({ color: '#22d3ee', points: samples.map((s) => s.cons_watts ?? 0) })

  const bp = d.metered && c ? barPair(p?.watt_hours_today, c?.watt_hours_today) : null

  return (
    <div className="space-y-4">
      {/* Hero: radial gauge + animated flow over a warm radiant backdrop. */}
      <div
        className="relative overflow-hidden rounded-xl border border-amber-500/20 p-5"
        style={{
          background:
            'radial-gradient(120% 120% at 50% -10%, rgba(245,158,11,0.18), transparent 60%)',
        }}
      >
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-around">
          <SolarGauge watts={p?.watts_now} fraction={frac} glow={glow} />
          <div className="w-full max-w-xs">
            <SolarFlow model={model} production={p} consumption={c} />
          </div>
        </div>
        {net && (
          <div className={`mt-1 text-center text-sm font-medium ${net.tone}`}>{net.text}</div>
        )}
      </div>

      {/* Production energy totals (gold). */}
      <Section title="Production" tone="text-amber-400/90">
        <div className="grid grid-cols-3 gap-3">
          <EnergyTile tone="gold" label="Today" value={formatKwh(p?.watt_hours_today)} />
          <EnergyTile tone="gold" label="Last 7 days" value={formatKwh(p?.watt_hours_last_7_days)} />
          <EnergyTile tone="gold" label="Lifetime" value={formatKwh(p?.watt_hours_lifetime)} />
        </div>
      </Section>

      {/* Consumption — only on metered systems (CT clamps installed). */}
      {d.metered && c && (
        <Section title="Consumption" tone="text-cyan-400/90">
          <div className="grid grid-cols-3 gap-3">
            <EnergyTile tone="cyan" label="Now" value={formatWatts(c.watts_now)} />
            <EnergyTile tone="cyan" label="Today" value={formatKwh(c.watt_hours_today)} />
            <EnergyTile tone="cyan" label="Lifetime" value={formatKwh(c.watt_hours_lifetime)} />
          </div>
        </Section>
      )}

      {/* Today's balance: produced vs used (metered only). */}
      {bp && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h3 className="mb-3 text-sm font-medium text-slate-300">Today’s balance</h3>
          <PairBar label="Produced" tone="gold" frac={bp.prod} value={formatKwh(p?.watt_hours_today)} />
          <PairBar label="Used" tone="cyan" frac={bp.cons} value={formatKwh(c?.watt_hours_today)} />
        </div>
      )}

      {/* Intraday production trend (gold; + cyan consumption when metered). */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-300">Today’s curve</h3>
        {samples.length > 0 ? (
          <Graph heightClass="h-28" height={112} series={series} />
        ) : (
          <p className="text-xs text-slate-500">
            The day’s curve fills in as readings are collected.
          </p>
        )}
      </div>

      {!d.metered && (
        <p className="text-xs text-slate-500">
          This system isn’t metered (no consumption CT clamps), so only production is reported.
        </p>
      )}
    </div>
  )
}

function Section({ title, tone, children }) {
  return (
    <div>
      <h3 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${tone}`}>{title}</h3>
      {children}
    </div>
  )
}

function EnergyTile({ tone, label, value }) {
  const cls =
    tone === 'cyan'
      ? 'border-cyan-500/20 from-cyan-500/15 to-sky-700/5'
      : 'border-amber-500/20 from-amber-400/15 to-yellow-600/5'
  return (
    <div className={`rounded-lg border bg-gradient-to-br p-3 text-center ${cls}`}>
      <div className="text-lg font-semibold tabular-nums text-slate-100">{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  )
}

function PairBar({ label, tone, frac, value }) {
  const fill = tone === 'cyan' ? 'bg-cyan-400' : 'bg-amber-400'
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="tabular-nums text-slate-300">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full ${fill}`}
          style={{ width: `${Math.round((frac || 0) * 100)}%` }}
        />
      </div>
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
