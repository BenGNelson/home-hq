// The animated energy-flow diagram: Solar · Battery · Grid · Home, with dashes
// drifting from source to target along each active leg to suggest power moving
// (the animation lives in index.css as .solar-flow-line). Colors encode the flow:
// gold solar, green battery, emerald exporting, amber importing, dim slate when
// idle. The flow model (which edges, which direction, active or not) is pure
// (lib/solar.js flowModel), built from the backend's measured `power` block.
//
// Layout: a diamond — Solar top, Home center, Grid left, Battery right. Connector
// lines are drawn in an SVG that scales uniformly to the container (fixed viewBox
// aspect), with HTML node chips positioned over the same anchors as percentages.
import { Sun, House, Zap, BatteryMedium, BatteryCharging } from 'lucide-react'
import { formatWatts } from '../lib/solar.js'

const W = 260
const H = 200
const POS = {
  solar: { x: 130, y: 30 },
  home: { x: 130, y: 122 },
  grid: { x: 42, y: 152 },
  battery: { x: 218, y: 152 },
}
const TONE = {
  gold: '#f59e0b',
  green: '#4ade80',
  emerald: '#34d399',
  amber: '#fbbf24',
  slate: '#475569',
}
const pct = (v, total) => `${((v / total) * 100).toFixed(2)}%`

function NodeChip({ at, Icon, tint, label, value, sub }) {
  return (
    <div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
      style={{ left: pct(at.x, W), top: pct(at.y, H) }}
    >
      <span className={`flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 bg-slate-900/80 ${tint}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="text-[11px] font-medium text-slate-300">{label}</span>
      {value != null && <span className="text-[11px] tabular-nums text-slate-400">{value}</span>}
      {sub != null && <span className="text-[10px] tabular-nums text-slate-500">{sub}</span>}
    </div>
  )
}

// Battery chip tone by state of charge.
function socTint(soc) {
  if (soc == null) return 'text-slate-300'
  if (soc >= 50) return 'text-emerald-300'
  if (soc >= 20) return 'text-amber-300'
  return 'text-rose-300'
}

export function SolarFlow({ model, power, battery }) {
  const grid = power?.grid
  let gridValue = null
  let gridTint = 'text-slate-300'
  if (grid) {
    if (grid.dir === 'importing') {
      gridValue = `↓ ${formatWatts(grid.watts)}`
      gridTint = 'text-amber-300'
    } else if (grid.dir === 'exporting') {
      gridValue = `↑ ${formatWatts(grid.watts)}`
      gridTint = 'text-emerald-300'
    } else {
      gridValue = 'idle'
    }
  }

  // Show the battery node whenever the SYSTEM has a battery (the card source),
  // not just when its instantaneous flow is reported — so the diagram and the
  // Battery card never disagree on a partial read.
  const batt = battery || null
  const battSub = !batt
    ? null
    : batt.state === 'charging'
      ? `↓ ${formatWatts(batt.watts)}`
      : batt.state === 'discharging'
        ? `↑ ${formatWatts(batt.watts)}`
        : batt.state === 'idle'
          ? 'idle'
          : null
  // If there's a battery but no flow edge this read, draw a dim static leg so the
  // node isn't floating disconnected.
  const hasBatteryEdge = model.edges.some((e) => e.from === 'battery' || e.to === 'battery')

  return (
    <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {model.edges.map((e) => {
          const a = POS[e.from]
          const b = POS[e.to]
          const color = TONE[e.tone] || TONE.slate
          return (
            <g key={e.id}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth="2.5" opacity="0.22" />
              {e.active && (
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray="2 10"
                  className="solar-flow-line"
                />
              )}
            </g>
          )
        })}
        {batt && !hasBatteryEdge && (
          <line
            x1={POS.battery.x}
            y1={POS.battery.y}
            x2={POS.home.x}
            y2={POS.home.y}
            stroke={TONE.slate}
            strokeWidth="2.5"
            opacity="0.22"
          />
        )}
      </svg>

      <NodeChip at={POS.solar} Icon={Sun} tint="text-yellow-300" label="Solar" value={formatWatts(power?.solar?.watts)} />
      <NodeChip
        at={POS.home}
        Icon={House}
        tint="text-cyan-300"
        label="Home"
        value={power?.load ? formatWatts(power.load.watts) : null}
      />
      {power?.grid && (
        <NodeChip at={POS.grid} Icon={Zap} tint={gridTint} label="Grid" value={gridValue} />
      )}
      {batt && (
        <NodeChip
          at={POS.battery}
          Icon={batt.state === 'charging' ? BatteryCharging : BatteryMedium}
          tint={socTint(batt.soc_percent)}
          label="Battery"
          value={batt.soc_percent != null ? `${batt.soc_percent}%` : null}
          sub={battSub}
        />
      )}
    </div>
  )
}
