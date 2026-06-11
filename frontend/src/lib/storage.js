// Pure helpers for the Storage page + Drives widget. Kept side-effect free so
// they're unit-tested (see storage.test.js).

// Per-drive SMART health badge: grey when SMART couldn't be read (e.g. a USB
// bridge), red on a FAILED self-assessment, amber when there are warnings
// (reallocated sectors, high wear…) even if the overall verdict still "passed",
// green otherwise.
export function smartBadge(d) {
  if (!d.supported) return { label: 'n/a', cls: 'text-slate-500' }
  if (d.passed === false) return { label: 'FAILED', cls: 'text-rose-400' }
  if (d.warnings?.length) return { label: 'warn', cls: 'text-amber-400' }
  return { label: 'OK', cls: 'text-emerald-400' }
}

// A small tag identifying a drive's role on the box (array member vs OS disk).
export function roleTag(role) {
  if (role === 'raid') return { label: 'RAID', cls: 'bg-sky-500/15 text-sky-300' }
  if (role === 'system') return { label: 'OS', cls: 'bg-violet-500/15 text-violet-300' }
  return null
}

// Plain-language "how many drives can I lose" for a RAID level string.
export function raidRedundancy(level) {
  const l = (level || '').toLowerCase()
  if (l.includes('raid6')) return 'Tolerates 2 drives failing at once'
  if (l.includes('raid10')) return 'Tolerates 1 drive failing per mirror'
  if (l.includes('raid5')) return 'Tolerates 1 drive failing'
  if (l.includes('raid1')) return 'Mirrored — tolerates all but one drive failing'
  if (l.includes('raid0')) return 'No redundancy — losing any drive loses the array'
  return null
}

// Reduce a trend metric series ([{value}, …]) to plain numbers for the Graph.
// Nulls become 0 so a missing reading doesn't break the line.
export function seriesPoints(series) {
  if (!Array.isArray(series)) return []
  return series.map((s) => (typeof s.value === 'number' ? s.value : 0))
}

// Interpret the capacity projection from /api/storage/trends into a UI-ready
// shape: 'unknown' = not enough history yet, 'flat' = stable/shrinking, or
// 'growing' with per-week growth and an optional weeks-until-full estimate.
export function summarizeProjection(p) {
  if (!p) return { state: 'unknown' }
  const perDay = p.bytes_per_day
  if (!perDay || perDay <= 0) return { state: 'flat' }
  const days = p.days_until_full
  return {
    state: 'growing',
    perDayBytes: perDay,
    perWeekBytes: perDay * 7,
    daysUntilFull: days ?? null,
    weeksUntilFull: days != null ? days / 7 : null,
  }
}
