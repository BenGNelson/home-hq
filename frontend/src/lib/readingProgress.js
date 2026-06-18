// Reading position (last page viewed) per item — stored client-side for now,
// consistent with the Library's other "this device" state (recentGames); it
// graduates to the backend when reading-sync / offline lands. Storage is
// injected so the logic is unit-testable without a DOM.

const KEY = 'homehq.readingProgress'

function store() {
  return typeof localStorage !== 'undefined' ? localStorage : null
}

function readAll(storage) {
  if (!storage) return {}
  try {
    const v = JSON.parse(storage.getItem(KEY) || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

// Last page viewed for an item (1-based), or 1 if none/invalid.
export function getLastPage(itemKey, storage = store()) {
  const p = readAll(storage)[itemKey]
  return Number.isInteger(p) && p > 0 ? p : 1
}

// Remember the page for an item. Returns the saved page (or the existing one if
// the input is invalid).
export function setLastPage(itemKey, page, storage = store()) {
  if (!itemKey || !Number.isInteger(page) || page < 1) {
    return getLastPage(itemKey, storage)
  }
  if (storage) {
    try {
      const all = readAll(storage)
      all[itemKey] = page
      storage.setItem(KEY, JSON.stringify(all))
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }
  return page
}
