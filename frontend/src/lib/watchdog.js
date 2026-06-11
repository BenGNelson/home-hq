// Map a /drive-watchdog state into a status badge for the Drives widget.
// stale     -> the watchdog isn't writing (its process is down); state unknown.
// healthy   -> mounted and probing OK.
// failed    -> a recovery attempt didn't restore health (needs a look).
// recovering-> unhealthy but the watchdog is acting on it.
export function watchdogBadge(d) {
  if (d.stale) return { label: 'idle', cls: 'text-slate-500' }
  if (d.healthy) return { label: 'OK', cls: 'text-emerald-400' }
  if (d.note === 'recovery-failed') return { label: 'failed', cls: 'text-rose-400' }
  return { label: 'recovering', cls: 'text-amber-400' }
}
