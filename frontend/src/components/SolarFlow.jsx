// The animated energy-flow diagram: Sun → Home ↔ Grid, with dashes drifting from
// source to target along each active leg to suggest power moving (the animation
// lives in index.css as .solar-flow-line). Colors encode direction: gold solar,
// emerald exporting, amber importing, dim slate when idle/balanced. The flow
// model (which edges, which direction, active or not) is pure (lib/solar.js).
//
// Layout: connector lines are drawn in an SVG that scales uniformly to the
// container (fixed viewBox aspect), with HTML node chips positioned over the same
// anchors as percentages — the same svg-plus-overlay trick as Donut/SolarGauge.
import { Sun, House, Zap } from 'lucide-react'
import { formatWatts } from '../lib/solar.js'

// Drawing space. The container is locked to this aspect so the % node positions
// line up exactly with the line endpoints.
const W = 260
const H = 170
const POS = {
  solar: { x: 52, y: 42 },
  grid: { x: 52, y: 128 },
  home: { x: 208, y: 85 },
}
const TONE = { gold: '#f59e0b', emerald: '#34d399', amber: '#fbbf24', slate: '#475569' }
const pct = (v, total) => `${((v / total) * 100).toFixed(2)}%`

function NodeChip({ at, Icon, tint, label, value }) {
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
    </div>
  )
}

export function SolarFlow({ model, production, consumption }) {
  const prod = production?.watts_now
  const cons = consumption?.watts_now

  // The grid chip's caption summarizes the net flow, color-matched to the edge.
  const gridEdge = model.edges.find((e) => e.from === 'grid' || e.to === 'grid')
  let gridValue = null
  let gridTint = 'text-slate-400'
  if (gridEdge) {
    if (gridEdge.tone === 'emerald') {
      gridValue = `↑ ${formatWatts(gridEdge.watts)}`
      gridTint = 'text-emerald-400'
    } else if (gridEdge.tone === 'amber') {
      gridValue = `↓ ${formatWatts(gridEdge.watts)}`
      gridTint = 'text-amber-400'
    } else {
      // Idle slate link: net exactly zero is "balanced"; a null (unknown) net is "—".
      gridValue = gridEdge.watts === 0 ? 'balanced' : '—'
    }
  }

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
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth="2.5" opacity="0.25" />
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
      </svg>

      <NodeChip at={POS.solar} Icon={Sun} tint="text-yellow-300" label="Solar" value={formatWatts(prod)} />
      <NodeChip
        at={POS.home}
        Icon={House}
        tint="text-cyan-300"
        label="Home"
        value={model.metered ? formatWatts(cons) : null}
      />
      {model.metered && (
        <NodeChip at={POS.grid} Icon={Zap} tint={gridTint} label="Grid" value={gridValue} />
      )}
    </div>
  )
}
