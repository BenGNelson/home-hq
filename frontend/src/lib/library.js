// Pure helpers for the Library (owned-content hub). The pages just render.
import { API_BASE } from './useApi.js'

// Where the EmulatorJS engine + cores load from. Default: self-hosted at
// /emulatorjs/ (populate with scripts/fetch-emulatorjs.sh — a pinned, gitignored
// bundle, so nothing third-party is committed and play time makes no external
// calls). To use the official pinned CDN instead, set this to
// 'https://cdn.emulatorjs.org/4.2.3/data/'. emulator.html allowlists both forms.
export const EMULATORJS_DATA = '/emulatorjs/'

// URL the backend streams an item's bytes from. Range-capable, so a reader or
// emulator can fetch only the bytes it needs (matters for big PDFs later).
export function fileUrl(section, id) {
  return `${API_BASE}/library/file?section=${encodeURIComponent(section)}&id=${encodeURIComponent(id)}`
}

// Proxied + cached box art for a game (404 → caller shows a placeholder).
export function coverUrl(id) {
  return `${API_BASE}/library/games/cover?id=${encodeURIComponent(id)}`
}

// Server-side save states for a game (roam across devices).
export function saveStatesUrl(id) {
  return `${API_BASE}/library/games/save-states?id=${encodeURIComponent(id)}`
}
// The state blob — what EJS_loadStateURL fetches to resume into a state.
export function saveStateUrl(id, slot) {
  return `${API_BASE}/library/games/save-state?id=${encodeURIComponent(id)}&slot=${encodeURIComponent(slot)}`
}
// A save state's screenshot (detail-page thumbnail).
export function saveStateShotUrl(id, slot) {
  return `${API_BASE}/library/games/save-state/screenshot?id=${encodeURIComponent(id)}&slot=${encodeURIComponent(slot)}`
}

// The isolated player page (public/emulator.html) for a game item. Running
// EmulatorJS inside an iframe keeps its window globals + teardown out of the SPA.
export function playerSrc(item, data = EMULATORJS_DATA) {
  const q = new URLSearchParams({
    core: item.core,
    rom: fileUrl('games', item.id),
    data,
  })
  q.set('gid', item.id) // game id, so the emulator can upload save states for it
  if (item.name) q.set('name', item.name) // EJS_gameName — avoids an "undefined" title
  if (item.loadStateUrl) q.set('loadstate', item.loadStateUrl) // resume into a saved state
  return `/emulator.html?${q.toString()}`
}

// Group play items by their system label → ordered [[label, items], ...].
export function groupByLabel(items) {
  const groups = {}
  for (const it of items ?? []) (groups[it.label || 'Other'] ??= []).push(it)
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
}

// One-line summary for the hub header.
export function libraryHeadline(data) {
  const ready = (data?.sections ?? []).filter((s) => s.configured)
  if (ready.length === 0) return 'No content configured yet'
  const total = ready.reduce((n, s) => n + (s.count || 0), 0)
  const secWord = ready.length === 1 ? 'section' : 'sections'
  return `${total} item${total === 1 ? '' : 's'} across ${ready.length} ${secWord}`
}
