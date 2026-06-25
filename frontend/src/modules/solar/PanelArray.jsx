import { useState } from 'react'
import { useApi } from '../../lib/useApi.js'
import { panelColor, panelsPeak, splitSets, evenCols } from '../../lib/solarPanels.js'
import { formatWatts } from '../../lib/solar.js'

// The two physical arrays, by panel count (panels 1-8, then 9-29). Each renders
// as its own evenly-filled, centered block so there's no ragged trailing gap.
const SET_SIZES = [8, 21]

// The per-microinverter array: cells colored by each panel's current output
// relative to the best panel right now, so a shaded/underperforming panel reads
// dim. Tap (or hover) a cell to see its watts. Self-hides until panels report.
// Panels are indexed (no serials — those stay server-side).
export function PanelArray() {
  const { data } = useApi('/solar/panels', 60000) // panels move slowly — poll lightly
  const [sel, setSel] = useState(null)

  if (!data || data.available === false) return null
  const panels = data.panels || []
  if (panels.length === 0) return null

  const peak = panelsPeak(panels) // one scale across all panels, so sets compare
  const sets = splitSets(panels, SET_SIZES)
  const selected = sel != null ? panels.find((p) => p.i === sel) : null

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-slate-300">Array · {panels.length} panels</h3>
        <span className="text-xs tabular-nums text-slate-400">
          {selected ? `Panel ${selected.i} · ${formatWatts(selected.watts)}` : 'tap a panel'}
        </span>
      </div>
      <div className="space-y-4">
        {sets.map((set, idx) => (
          <div
            key={idx}
            className="grid justify-center gap-1.5"
            style={{ gridTemplateColumns: `repeat(${evenCols(set.length)}, minmax(0, 2.25rem))` }}
          >
            {set.map((p) => (
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
        ))}
      </div>
    </div>
  )
}
