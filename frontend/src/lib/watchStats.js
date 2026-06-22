// Pure shaping for the Plex Watch Stats period view. Null-guards every field so
// a partial or malformed period payload degrades to an empty view instead of
// throwing and white-screening the whole route. Kept here so it's unit-tested
// and WatchStats.jsx stays presentational.

// Distinct, theme-friendly palette (Tailwind *-400 hexes) cycled per viewer.
export const USER_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#22d3ee', '#fb923c', '#a3e635', '#e879f9', '#2dd4bf']
const TYPE_COLORS = { movie: '#38bdf8', episode: '#a78bfa' }
const OTHER_COLOR = '#94a3b8'

export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
export const fmtHours = (h) => (h == null ? '—' : `${h.toFixed(1)} h`)

// Shape one period for rendering. Returns null when there are no plays (the
// caller shows the empty state); otherwise a fully-guarded view object.
export function watchPeriodView(p, metric) {
  if (!p || !p.total_plays) return null

  const users = (p.by_user ?? []).map((u, i) => ({
    user: u.user,
    plays: u.plays,
    hours: u.hours,
    color: USER_COLORS[i % USER_COLORS.length],
  }))
  const userSegments = users.map((u) => ({
    label: u.user,
    value: metric === 'hours' ? u.hours : u.plays,
    color: u.color,
  }))
  const typeSegments = Object.entries(p.by_type ?? {}).map(([type, count]) => ({
    label: cap(type),
    value: count,
    color: TYPE_COLORS[type] || OTHER_COLOR,
  }))
  const centerTotal =
    metric === 'hours'
      ? { big: (p.total_hours ?? 0).toFixed(0), small: 'hours' }
      : { big: p.total_plays, small: 'plays' }

  return { users, userSegments, typeSegments, centerTotal, totalPlays: p.total_plays, top: p.top ?? [] }
}
