// Pure helpers for the Ad Blocking module — value formatting + the unavailable
// message. Kept here (not in the component) so they're unit-tested.

// A blocked percentage as a label, one decimal. Tolerates null.
export function formatPercent(pct) {
  if (pct == null) return '—'
  return `${pct.toFixed(1)}%`
}

// A query count with thousands separators (AdGuard counts add up fast). Tolerates null.
export function formatCount(n) {
  if (n == null) return '—'
  return n.toLocaleString()
}

// The first `limit` blocked domains, for the dashboard widget's compact preview.
export function topDomainsPreview(domains, limit = 3) {
  if (!Array.isArray(domains)) return []
  return domains.slice(0, limit)
}

export function adguardUnavailableMessage(reason) {
  if (reason === 'not_configured') return 'Ad blocking isn’t configured yet.'
  if (reason === 'unreachable') return 'Can’t reach the AdGuard resolver right now.'
  return 'Ad-blocking data is unavailable.'
}
