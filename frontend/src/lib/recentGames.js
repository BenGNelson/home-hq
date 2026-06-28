// "Recently played" — stored client-side (this device) for now, consistent with
// in-browser saves; it graduates to the backend when save-roaming lands. Storage
// is injected so the logic is unit-testable without a DOM.

const KEY = 'homehq.recentGames'
const LIMIT = 12

function store() {
  return typeof localStorage !== 'undefined' ? localStorage : null
}

// Read the recent list (newest first). Tolerates missing/corrupt storage.
export function getRecent(storage = store()) {
  if (!storage) return []
  try {
    const v = JSON.parse(storage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

// Record a play: move this game to the front (dedup by id), cap the list, and
// stamp the time. Returns the new list.
export function recordPlayed(item, storage = store(), now = Date.now()) {
  if (!item?.id) return getRecent(storage)
  const entry = { id: item.id, name: item.name, core: item.core, label: item.label, ts: now }
  const next = [entry, ...getRecent(storage).filter((g) => g.id !== item.id)].slice(0, LIMIT)
  if (storage) {
    try {
      storage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }
  return next
}

// Remove a game from the recent list (the ✕ on its "Recently played" tile). Only
// clears the recently-played marker — the game's save files are never touched.
// Returns the new list.
export function removeRecent(id, storage = store()) {
  const next = getRecent(storage).filter((g) => g.id !== id)
  if (storage) {
    try {
      storage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }
  return next
}
