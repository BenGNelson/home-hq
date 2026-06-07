// Human-friendly formatting helpers shared by the widgets.

export function formatBytes(bytes) {
  if (bytes == null) return '—'
  const gib = bytes / 1024 ** 3
  if (gib >= 1024) return `${(gib / 1024).toFixed(1)} TiB`
  return `${gib.toFixed(1)} GiB`
}

export function formatUptime(seconds) {
  if (seconds == null) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
