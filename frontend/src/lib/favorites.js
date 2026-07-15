// Favorite games — starred on a game's page, browsed as a rail in Frog. Stored
// client-side (this device), the same as "recently played" and in-browser saves;
// it graduates to the backend when save-roaming does. Storage is injected so the
// logic is unit-testable without a DOM.
//
// A favorite keeps just enough to launch and re-hydrate: id + core + name + label.
// The cover is fetched from the id, and the live library is the source of truth for
// the name — a favorite whose game has left the library simply drops out (see the
// shelf's re-hydration), never a stale copy.

const KEY = 'homehq.favorites'

function store() {
  return typeof localStorage !== 'undefined' ? localStorage : null
}

// The favorites, newest-first. Tolerates missing/corrupt storage.
export function getFavorites(storage = store()) {
  if (!storage) return []
  try {
    const v = JSON.parse(storage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function isFavorite(id, storage = store()) {
  return getFavorites(storage).some((g) => g.id === id)
}

function write(list, storage) {
  if (!storage) return
  try {
    storage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

// Star a game (moves it to the front). Returns the new list.
export function addFavorite(item, storage = store()) {
  if (!item?.id) return getFavorites(storage)
  const entry = { id: item.id, name: item.name, core: item.core, label: item.label }
  const next = [entry, ...getFavorites(storage).filter((g) => g.id !== item.id)]
  write(next, storage)
  return next
}

export function removeFavorite(id, storage = store()) {
  const next = getFavorites(storage).filter((g) => g.id !== id)
  write(next, storage)
  return next
}

// Toggle, for the star button. Returns { favorited, list } so the caller can update
// its own state without a second read.
export function toggleFavorite(item, storage = store()) {
  if (isFavorite(item?.id, storage)) {
    return { favorited: false, list: removeFavorite(item.id, storage) }
  }
  return { favorited: true, list: addFavorite(item, storage) }
}
