// Pure helpers for the camera wall — kept out of the component so they're
// unit-testable without rendering. The stream/snapshot URLs ride the shared API
// base (same origin as the app), so the browser never needs an HA token.
import { API_BASE } from './useApi.js'

export function cameraStreamUrl(entityId) {
  return `${API_BASE}/ha/camera/${encodeURIComponent(entityId)}/stream`
}

export function cameraSnapshotUrl(entityId) {
  return `${API_BASE}/ha/camera/${encodeURIComponent(entityId)}/snapshot`
}

// Pick a responsive grid column count for N cameras: one fills the width,
// two-to-four go two-up, five-plus go three-up on large screens.
export function gridColsClass(count) {
  if (count <= 1) return 'grid-cols-1'
  if (count <= 4) return 'sm:grid-cols-2'
  return 'sm:grid-cols-2 lg:grid-cols-3'
}
