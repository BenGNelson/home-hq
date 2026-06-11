import { printerStatus } from '../../lib/printer.js'

// Full class strings (no string interpolation) so Tailwind's scanner keeps them.
const TONE = {
  sky: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  emerald: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  rose: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  slate: 'bg-slate-700/40 text-slate-300 ring-slate-600/40',
}

export default function StateBadge({ state }) {
  const { label, tone } = printerStatus(state)
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[tone]}`}
    >
      {label}
    </span>
  )
}
