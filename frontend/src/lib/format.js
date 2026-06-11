// Human-friendly formatting helpers shared by the widgets.

export function formatBytes(bytes) {
  if (bytes == null) return '—'
  const gib = bytes / 1024 ** 3
  if (gib >= 1024) return `${(gib / 1024).toFixed(1)} TiB`
  return `${gib.toFixed(1)} GiB`
}

export function formatRate(bytesPerSec) {
  if (bytesPerSec == null) return '—'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let v = bytesPerSec
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(i > 0 && v < 10 ? 1 : 0)} ${units[i]}`
}

export function formatClock(ts) {
  if (ts == null) return ''
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatDuration(ms) {
  if (!ms) return '—'
  const totalMin = Math.round(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

const RESOLUTIONS = {
  '4k': '4K',
  '1080': '1080p',
  '720': '720p',
  '576': '576p',
  '480': '480p',
  sd: 'SD',
}

export function formatResolution(res) {
  if (!res) return '—'
  return RESOLUTIONS[String(res).toLowerCase()] ?? res
}

export function formatDate(epoch) {
  if (!epoch) return '—'
  return new Date(epoch * 1000).toLocaleDateString()
}

export function formatDateTime(epoch) {
  if (!epoch) return '—'
  const d = new Date(epoch * 1000)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

// Byte size in B/KB/MB/GB (for files, not rates — see formatRate for /s).
export function formatSize(bytes) {
  if (bytes == null) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(i > 0 && v < 10 ? 1 : 0)} ${units[i]}`
}

export function formatAgo(epoch) {
  if (!epoch) return 'never'
  const s = Math.floor(Date.now() / 1000 - epoch)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Minutes -> "37m" / "1h 23m" (printer time-remaining is reported in minutes).
export function formatMinutes(min) {
  if (min == null) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
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
