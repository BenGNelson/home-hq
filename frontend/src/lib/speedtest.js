// Pure formatters for the Speedtest / ISP monitor. Kept here (not in the
// component) so they're unit-tested.

// Throughput: Mbps with one decimal. null/undefined -> em dash.
export function formatMbps(n) {
  if (n == null) return '—'
  return `${n.toFixed(1)} Mbps`
}

// Latency: milliseconds with one decimal. null/undefined -> em dash.
export function formatPing(ms) {
  if (ms == null) return '—'
  return `${ms.toFixed(1)} ms`
}

// The history windows offered on the Speed page. Each `key` matches a backend
// /speedtest/history `range` (keep in sync with HISTORY_RANGES in speedtest.py);
// `label` is the button text.
export const SPEEDTEST_RANGES = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: '1y', label: '1yr' },
]

// Default selection: a month is a good "running score" view (week/month/year all
// fill in over time at the 6h sampling cadence).
export const DEFAULT_SPEEDTEST_RANGE = '30d'

export function isSpeedtestRange(key) {
  return SPEEDTEST_RANGES.some((r) => r.key === key)
}
