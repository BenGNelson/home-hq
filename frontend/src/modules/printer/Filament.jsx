import { colorName } from '../../lib/printer.js'

// Shared filament rendering: big, loud spool swatches for the Printer page and a
// labeled at-a-glance row for the dashboard widget. `color` is the printer's
// 6-hex tray_color (alpha stripped); null = an empty slot. The printer only
// sends a hex value, so colorName() derives the human-readable name.

function colorStyle(color) {
  return color ? { backgroundColor: `#${color}` } : undefined
}

// Large, prominent spool swatch — colors front-and-center on the Printer page.
export function FilamentSpool({ tray }) {
  const empty = !tray.type
  const name = empty ? 'empty' : colorName(tray.color)
  return (
    <div className="flex w-20 flex-col items-center gap-2">
      <div
        className={`h-20 w-16 rounded-lg ${
          empty
            ? 'border-2 border-dashed border-slate-700'
            : tray.active
              ? 'shadow-lg shadow-emerald-500/30 ring-2 ring-emerald-400'
              : 'ring-1 ring-slate-500/60'
        }`}
        style={colorStyle(tray.color)}
        title={empty ? 'empty' : `${name} ${tray.type}`}
      />
      <div className="text-center leading-tight">
        <div className="text-xs font-medium text-slate-200">{name}</div>
        {!empty && <div className="text-[11px] text-slate-500">{tray.type}</div>}
        {tray.remain != null && tray.remain >= 0 && (
          <div className="text-[11px] text-slate-500">{tray.remain}%</div>
        )}
        {tray.active && <div className="text-[11px] font-medium text-emerald-400">in use</div>}
      </div>
    </div>
  )
}

// Dashboard row: each loaded spool as a swatch + color name, with the in-use one
// highlighted and tagged. Wraps/expands to the right (it owns its own line).
export function FilamentList({ ams }) {
  const trays = (ams ?? []).flatMap((u) => u.trays).filter((t) => t.type)
  if (trays.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      {trays.map((t, i) => (
        <span
          key={i}
          className={`inline-flex items-center gap-1.5 ${
            t.active ? 'text-emerald-300' : 'text-slate-300'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full ${
              t.active ? 'ring-2 ring-emerald-400' : 'ring-1 ring-slate-500/60'
            }`}
            style={colorStyle(t.color)}
          />
          <span>{colorName(t.color)}</span>
          {t.active && (
            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
              in use
            </span>
          )}
        </span>
      ))}
    </div>
  )
}
