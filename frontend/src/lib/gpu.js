// The GPU to show in the System widget — the first reported adapter, or null
// when GPU stats aren't available (no NVIDIA GPU, or the host timer hasn't run
// yet). Keeps the widget's render free of availability/empty-list checks.
export function primaryGpu(data) {
  if (!data || !data.available) return null
  return data.gpus?.[0] ?? null
}

// The one-line caption under the GPU utilization bar: load %, then temperature
// and active encode sessions when present. The encode-session count is the
// Plex-relevant bit, so it only shows when something is actually transcoding.
export function gpuCaption(g) {
  if (!g) return ''
  const parts = [`${g.utilization_percent ?? 0}%`]
  if (g.temperature_c != null) parts.push(`${g.temperature_c}°C`)
  if (g.encoder_sessions) parts.push(`${g.encoder_sessions} enc`)
  return parts.join(' · ')
}
