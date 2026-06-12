// Pure formatting helpers for the Plex insights page. Kept here so they're
// unit-tested and the page stays presentational.

// Busiest hour is a UTC hour (0-23). Show it as a readable "HH:00 UTC".
export function formatHour(h) {
  if (h == null) return '—'
  return `${String(h).padStart(2, '0')}:00 UTC`
}

// A 0..1 fraction → integer percent, or em dash when unknown.
export function formatShare(frac) {
  if (frac == null) return '—'
  return `${Math.round(frac * 100)}%`
}

// Plex reports reserved bandwidth in kbps; show Mbps for legibility.
export function formatMbps(kbps) {
  if (kbps == null) return '—'
  return `${(kbps / 1000).toFixed(1)} Mbps`
}
