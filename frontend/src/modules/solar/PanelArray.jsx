import { useState } from 'react'
import { useApi } from '../../lib/useApi.js'
import { panelColor, panelsPeak } from '../../lib/solarPanels.js'
import { formatWatts } from '../../lib/solar.js'

// The per-microinverter array: a grid of cells colored by each panel's current
// output relative to the best panel right now, so a shaded/underperforming panel
// reads dim. Tap (or hover) a cell to see its watts. Self-hides until panels are
// reported. Panels are indexed (no serials — those stay server-side).
export function PanelArray() {
  const { data } = useApi('/solar/panels', 60000) // panels move slowly — poll lightly
  const [sel, setSel] = useState(null)

  if (!data || data.available === false) return null
  const panels = data.panels || []
  if (panels.length === 0) return null

  const peak = panelsPeak(panels)
  const selected = sel != null ? panels.find((p) => p.i === sel) : null

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-slate-300">Array · {panels.length} panels</h3>
        <span className="text-xs tabular-nums text-slate-400">
          {selected ? `Panel ${selected.i} · ${formatWatts(selected.watts)}` : 'tap a panel'}
        </span>
      </div>
      <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10 lg:grid-cols-12">
        {panels.map((p) => (
          <button
            key={p.i}
            type="button"
            onClick={() => setSel(sel === p.i ? null : p.i)}
            title={`Panel ${p.i}: ${formatWatts(p.watts)}`}
            aria-label={`Panel ${p.i}, ${formatWatts(p.watts)}`}
            className={`aspect-square rounded-sm transition-transform hover:scale-110 ${sel === p.i ? 'ring-2 ring-amber-300' : ''}`}
            style={{ backgroundColor: panelColor(p.watts, peak) }}
          />
        ))}
      </div>
    </div>
  )
}
