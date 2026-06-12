// Pure helpers for the /api/uptime payload, so the page just renders.

// Tone (color class group) for a target's current status.
export function uptimeTone(status) {
  if (status === 'up') return 'good'
  if (status === 'down') return 'bad'
  return 'idle' // unknown / not yet probed
}

// Uptime percentage -> short label. null (no data) -> em dash.
export function formatPct(p) {
  if (p == null) return '—'
  // Whole numbers read cleaner without a trailing .0; otherwise one decimal.
  return `${Number.isInteger(p) ? p : p.toFixed(1)}%`
}

// Probe latency -> "12 ms" (null -> em dash).
export function formatMs(ms) {
  return ms == null ? '—' : `${ms} ms`
}

// A one-line summary verdict for the whole page header.
export function uptimeHeadline(data) {
  if (!data || data.configured === false) return 'No uptime data yet'
  const up = data.targets.filter((t) => t.status === 'up').length
  const total = data.targets.length
  return `${up}/${total} service${total === 1 ? '' : 's'} up`
}
