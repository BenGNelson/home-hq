import { useApi } from '../../lib/useApi.js'
import { useDelayedFlag } from '../../lib/useDelayedFlag.js'
import { Graph } from '../../components/Graph.jsx'
import { SolarGauge } from '../../components/SolarGauge.jsx'
import { SolarFlow } from '../../components/SolarFlow.jsx'
import { PanelArray } from './PanelArray.jsx'
import { radiantBackdrop } from '../../lib/glow.js'
import {
  formatWatts,
  formatKwh,
  clockLabel,
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
  // Reveal the skeleton only if the first load is actually slow (the Envoy poll
  // takes a beat), so a fast response never flashes a placeholder.
  const showSkeleton = useDelayedFlag(loading && !data && !error)

  return (
    <div>
      {/* Title omitted — the shell's top bar already shows "Solar". */}
      {!data && !error && (showSkeleton ? <SolarSkeleton /> : null)}
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
  const model = flowModel(d.power)

  // Scale the gauge against the best production seen (today's peak), so the dial
  // reads relative to this system's own output rather than a guessed capacity.
  const refPeak = Math.max(hist?.stats?.peak_watts || 0, p?.watts_now || 0, 1000)
  const frac = gaugeFraction(p?.watts_now, refPeak)
  const glow = glowIntensity(p?.watts_now, refPeak)

  const samples = hist?.samples || []
  const times = samples.map((s) => s.ts * 1000) // epoch-s → ms for the time axis

  // Today's production peak (value + when), for the gauge caption and a dot on the
  // curve. The history window is a rolling 24h, so right after midnight its stats
  // still describe yesterday's peak — restrict to samples since local midnight, and
  // only when there's real (non-zero) production to call out.
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  let peakWatts = null
  let peakTs = null
  for (const s of samples) {
    if (s.ts * 1000 < midnight.getTime() || s.prod_watts == null) continue
    if (peakWatts == null || s.prod_watts > peakWatts) {
      peakWatts = s.prod_watts
      peakTs = s.ts
    }
  }
  const hasPeak = peakWatts != null && peakWatts > 0
  const peakIdx = hasPeak ? samples.findIndex((s) => s.ts === peakTs) : -1
  const peakAt = hasPeak ? clockLabel(peakTs * 1000) : ''
  const series = [{ color: '#f59e0b', points: samples.map((s) => s.prod_watts ?? 0) }]
  const legend = [{ label: 'Production', color: '#f59e0b' }]
  if (d.metered) {
    series.push({ color: '#22d3ee', points: samples.map((s) => s.cons_watts ?? 0) })
    legend.push({ label: 'Consumption', color: '#22d3ee' })
  }
  // SoC trend: only samples that actually carry a reading, so missing values
  // (pre-migration rows / partial reads) don't plot as false 0% drops.
  const socSamples = d.battery ? samples.filter((s) => s.soc_percent != null) : []
  const hasSoc = socSamples.length > 0

  const bp = d.metered && c ? barPair(p?.watt_hours_today, c?.watt_hours_today) : null

  return (
    <div className="space-y-4">
      {/* Hero: radial gauge + animated 4-node flow over a warm radiant backdrop. */}
      <div
        className="relative overflow-hidden rounded-xl border border-amber-500/30 p-5"
        style={{ background: radiantBackdrop('245,158,11') }}
      >
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-around">
          <SolarGauge watts={p?.watts_now} fraction={frac} glow={glow} />
          {d.power && (
            <div className="w-full max-w-sm">
              <SolarFlow model={model} power={d.power} battery={d.battery} />
            </div>
          )}
        </div>
        {hasPeak && (
          <div className="mt-1 text-center text-xs text-amber-300/80">
            Today’s peak {formatWatts(peakWatts)}
            {peakAt ? ` at ${peakAt}` : ''}
          </div>
        )}
        {d.self_sufficiency_percent != null && (
          <div className="mt-1 text-center text-sm font-medium text-emerald-400">
            {d.self_sufficiency_percent}% self-sufficient right now
          </div>
        )}
      </div>

      {/* Battery (IQ/Encharge) — only when storage is present. */}
      {d.battery && <BatterySection b={d.battery} />}

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
          <Graph
            heightClass="h-28"
            height={112}
            series={series}
            legend={legend}
            times={times}
            formatValue={formatWatts}
            peakMarker={peakIdx >= 0 ? { index: peakIdx, label: peakAt } : undefined}
          />
        ) : (
          <p className="text-xs text-slate-500">
            The day’s curve fills in as readings are collected.
          </p>
        )}
      </div>

      {/* Battery charge over the day (SoC %), when storage + samples exist. */}
      {hasSoc && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h3 className="mb-3 text-sm font-medium text-slate-300">Battery charge</h3>
          <Graph
            heightClass="h-20"
            height={80}
            unit="%"
            times={socSamples.map((s) => s.ts * 1000)}
            legend={[{ label: 'State of charge', color: '#4ade80' }]}
            series={[{ color: '#4ade80', points: socSamples.map((s) => s.soc_percent) }]}
          />
        </div>
      )}

      {/* Per-panel array — only when the system reports production (has
          microinverters); self-hides until panels report. */}
      {d.power?.solar && <PanelArray />}

      {!d.metered && (
        <p className="text-xs text-slate-500">
          This system isn’t metered (no consumption CT clamps), so only production is reported.
        </p>
      )}
    </div>
  )
}

function BatterySection({ b }) {
  const soc = b.soc_percent
  const fill =
    soc == null ? 'bg-slate-600' : soc >= 50 ? 'bg-emerald-500' : soc >= 20 ? 'bg-amber-500' : 'bg-rose-500'
  const state =
    b.state === 'charging'
      ? `Charging ${formatWatts(b.watts)}`
      : b.state === 'discharging'
        ? `Discharging ${formatWatts(b.watts)}`
        : b.state === 'idle'
          ? 'Idle'
          : '—'
  return (
    <Section title="Battery" tone="text-emerald-400/90">
      <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-transparent p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-slate-300">
            {b.count ? `${b.count} batteries` : 'Battery'}
            {b.grid_state ? ` · ${b.grid_state}` : ''}
          </span>
          <span className="tabular-nums text-slate-400">{state}</span>
        </div>
        {/* SoC meter with a dashed backup-reserve marker. */}
        <div className="relative h-6 w-full overflow-hidden rounded-md border border-slate-700 bg-slate-800">
          {soc != null && (
            <div className={`h-full ${fill} transition-all`} style={{ width: `${soc}%` }} />
          )}
          {b.reserve_percent != null && (
            <div
              className="absolute inset-y-0 border-l border-dashed border-slate-200/70"
              style={{ left: `${b.reserve_percent}%` }}
              title={`backup reserve ${b.reserve_percent}%`}
            />
          )}
          <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-slate-100">
            {soc != null ? `${soc}%` : '—'}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <EnergyTile tone="green" label="Available" value={formatKwh(b.available_wh)} />
          <EnergyTile tone="green" label="Capacity" value={formatKwh(b.capacity_wh)} />
          <EnergyTile tone="green" label="Reserve" value={b.reserve_percent != null ? `${b.reserve_percent}%` : '—'} />
        </div>
      </div>
    </Section>
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
      : tone === 'green'
        ? 'border-emerald-500/20 from-emerald-500/15 to-green-700/5'
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

// Loading placeholder shaped to the live layout (hero gauge + flow, battery,
// energy tiles, balance, the two curves, and the two-set array) so the page holds
// its height and doesn't pop in. Tuned for the metered + battery layout (the
// common case); a minimal system just settles up slightly once data lands.
function SolarSkeleton() {
  const block = 'rounded-xl border border-slate-800 bg-slate-900/50 p-4'
  const fill = 'rounded bg-slate-800/60'
  const Label = () => <div className={`mb-2 h-3 w-24 ${fill}`} />
  const Tiles = () => (
    <div className="grid grid-cols-3 gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-lg border border-slate-800/60 p-3">
          <div className={`mx-auto h-6 w-16 ${fill}`} />
          <div className={`mx-auto mt-1.5 h-3 w-10 ${fill}`} />
        </div>
      ))}
    </div>
  )
  const ChartCard = ({ h }) => (
    <div className={block}>
      <div className={`mb-3 h-4 w-28 ${fill}`} />
      <div className={`${h} w-full rounded-md bg-slate-800/40`} />
    </div>
  )
  const grid = (n, cols) => (
    <div className="grid justify-center gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 2.25rem))` }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="aspect-square rounded-sm bg-slate-800/50" />
      ))}
    </div>
  )

  return (
    <div className="animate-pulse space-y-4" role="status" aria-label="Loading solar data">
      <span className="sr-only">Loading solar data…</span>
      {/* Hero: gauge + flow */}
      <div className="rounded-xl border border-slate-800 p-5">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-around">
          <div className="h-[200px] w-[200px] shrink-0 rounded-full bg-slate-800/50" />
          <div className="w-full max-w-sm">
            <div className="w-full rounded-lg bg-slate-800/40" style={{ aspectRatio: '260 / 200' }} />
          </div>
        </div>
        <div className={`mx-auto mt-2 h-4 w-44 ${fill}`} />
      </div>

      {/* Battery */}
      <div>
        <Label />
        <div className="rounded-xl border border-slate-800 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className={`h-4 w-28 ${fill}`} />
            <div className={`h-4 w-20 ${fill}`} />
          </div>
          <div className={`h-6 w-full rounded-md bg-slate-800/60`} />
          <div className="mt-3">
            <Tiles />
          </div>
        </div>
      </div>

      {/* Production + Consumption */}
      <div>
        <Label />
        <Tiles />
      </div>
      <div>
        <Label />
        <Tiles />
      </div>

      {/* Today's balance */}
      <div className={block}>
        <div className={`mb-3 h-4 w-28 ${fill}`} />
        {[0, 1].map((i) => (
          <div key={i} className="mb-2">
            <div className="mb-1 flex justify-between">
              <div className={`h-3 w-16 ${fill}`} />
              <div className={`h-3 w-12 ${fill}`} />
            </div>
            <div className="h-2 w-full rounded-full bg-slate-800/60" />
          </div>
        ))}
      </div>

      {/* The two curves + the array */}
      <ChartCard h="h-28" />
      <ChartCard h="h-20" />
      <div className={block}>
        <div className={`mb-3 h-4 w-32 ${fill}`} />
        <div className="space-y-4">
          {grid(8, 8)}
          {grid(21, 7)}
        </div>
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
