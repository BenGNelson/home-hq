import { API_BASE } from './useApi.js'

// The Cards module accent (fuchsia) as an "r,g,b" string, for the back-lit
// radiance motif on the hub hero + show-off wall (matches the sidebar tint).
export const CARDS_RGB = '217,70,239' // fuchsia-500

// A card face, served same-origin through the backend proxy (never the external
// CDN — the app's CSP is img-src 'self', and the proxy caches a downscaled WebP).
// size: 'small' (grid thumb) | 'large' (detail face).
export function cardImageUrl(id, size = 'small') {
  return `${API_BASE}/cards/image?id=${encodeURIComponent(id)}&size=${size}`
}

export function setHref(setid) {
  return `/cards/sets/${encodeURIComponent(setid)}`
}

export function cardsSearchHref(q = '') {
  return q ? `/cards/search?q=${encodeURIComponent(q)}` : '/cards/search'
}

// Whole-number completion percentage, guarding a zero denominator.
export function completionPct(owned, total) {
  return total ? Math.round((100 * owned) / total) : 0
}

// A USD money string, or null when there's no value to show (so callers can hide
// the tile rather than print "$0" before prices are configured).
export function formatUsd(v) {
  if (v == null) return null
  return `$${Number(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
