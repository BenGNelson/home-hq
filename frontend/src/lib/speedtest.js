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
