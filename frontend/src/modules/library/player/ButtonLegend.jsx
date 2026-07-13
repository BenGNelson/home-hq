// The controller legend, the way every console UI does it: a quiet footer strip
// telling you which button does what right here. It's the difference between a
// menu you can drive with a pad and one you have to guess at.
export default function ButtonLegend({ hints, className = '', style }) {
  return (
    <div
      style={style}
      className={`pointer-events-none flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-400 ${className}`}
    >
      {hints.map(({ button, label }) => (
        <span key={button + label} className="flex items-center gap-1.5">
          <Glyph button={button} />
          {label}
        </span>
      ))}
    </div>
  )
}

// Xbox face-button colours, so the glyphs read at a glance rather than needing to
// be parsed. The Menu button gets the hamburger it actually has on the pad.
const FACE = {
  A: 'border-emerald-400/70 text-emerald-300',
  B: 'border-rose-400/70 text-rose-300',
  X: 'border-sky-400/70 text-sky-300',
  Y: 'border-amber-400/70 text-amber-300',
}

function Glyph({ button }) {
  const face = FACE[button]
  if (face) {
    return (
      <span
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full border bg-slate-900/80 text-[11px] font-bold leading-none ${face}`}
      >
        {button}
      </span>
    )
  }
  return (
    <span className="inline-flex h-5 items-center justify-center rounded border border-slate-600 bg-slate-900/80 px-1.5 text-[10px] font-semibold leading-none text-slate-300">
      {button}
    </span>
  )
}
