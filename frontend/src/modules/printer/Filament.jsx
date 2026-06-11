// Shared filament rendering: big, loud spool swatches for the Printer page and
// small at-a-glance color dots for the dashboard widget. `color` is the
// printer's 6-hex tray_color (alpha already stripped); null = an empty slot.

function colorStyle(color) {
  return color ? { backgroundColor: `#${color}` } : undefined
}

// Large, prominent spool swatch — the colors front-and-center on the Printer page.
export function FilamentSpool({ tray }) {
  const empty = !tray.type
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
        title={empty ? 'empty' : tray.type}
      />
      <div className="text-center leading-tight">
        <div className="text-xs font-medium text-slate-200">{empty ? 'empty' : tray.type}</div>
        {tray.remain != null && tray.remain >= 0 && (
          <div className="text-[11px] text-slate-500">{tray.remain}%</div>
        )}
        {tray.active && <div className="text-[11px] font-medium text-emerald-400">in use</div>}
      </div>
    </div>
  )
}

// Small color dots for the dashboard widget — loaded filament at a glance.
export function FilamentDots({ ams }) {
  const trays = (ams ?? []).flatMap((u) => u.trays).filter((t) => t.type)
  if (trays.length === 0) return null
  return (
    <div className="flex items-center gap-1.5">
      {trays.map((t, i) => (
        <span
          key={i}
          title={t.type}
          className={`inline-block h-3.5 w-3.5 rounded-full ${
            t.active ? 'ring-2 ring-emerald-400' : 'ring-1 ring-slate-500/60'
          }`}
          style={colorStyle(t.color)}
        />
      ))}
    </div>
  )
}
