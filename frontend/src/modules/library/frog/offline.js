// Frog, offline.
//
// The shelf, search and game list are all built from one thing: a list of game
// `items`, each `{ id, name, core, label }`. Online that list is the library API.
// Offline the API is gone, but the games you DOWNLOADED are on the device — the
// same manifest the rest of the Library falls back to (`allEntries()` in
// offlineStore). This turns those manifest rows into the exact item shape the
// shelf already knows how to draw, so offline Frog is the online Frog with a
// smaller library, not a separate screen.
//
// The one lossy bit: a download only ever stored a `core`, never the system label
// (the backend runs Game Boy Color on the `gba` core, so a core can't tell GBC
// from GBA). `systemForCore` is the documented fallback — the games still group
// and colour by a sensible machine, and they're the same ones that actually launch
// offline, which is all this view is for.

import { systemForCore } from './theme.js'

export function offlineGamesToItems(entries = []) {
  return entries
    .filter((e) => e && e.section === 'games' && e.id)
    .map((e) => ({
      id: e.id,
      name: e.name || e.id,
      core: e.core || '',
      label: systemForCore(e.core) || 'Other',
    }))
}
