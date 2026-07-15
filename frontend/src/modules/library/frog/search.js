// Search, as pure functions.
//
// The whole point of a controller keyboard is that you commit to a key and the app
// tells you, BEFORE you press it, whether that key leads anywhere. That judgement —
// "is this key dead?" — is decided here, so it's answerable by a test instead of by
// squinting at an iPad with a gamepad in your hands.

import { naturalCompare } from '../../../lib/library.js'

// The keys, laid out row-major into a 6×6 grid: A–Z then 0–9, which is exactly 36
// cells with none left over. No space and no punctuation on purpose — this is a
// SUBSTRING search, so "zelda" finds "The Legend of Zelda" without your ever typing
// a space, and every key you don't need is a key you can't fat-finger into.
export const KEYS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789']
export const COLS = 6

// Does this title contain the query? Case-insensitive, substring not prefix — a
// retro title buries the word you remember in the middle ("Super Mario World",
// "The Legend of Zelda") far more often than it starts with it.
export function matches(name, query) {
  if (!query) return true
  return (name || '').toLowerCase().includes(query.toLowerCase())
}

// The games a query finds, best-first. Capped because a two-letter query can match
// hundreds and nobody D-pads past the first screen — the cap is a courtesy to the
// renderer, not a limit on the search (you type another letter, you don't scroll).
export function searchGames(items = [], query, limit = 60) {
  if (!query) return []
  const q = query.toLowerCase()
  return items
    .filter((g) => (g.name || '').toLowerCase().includes(q))
    .sort((a, b) => naturalCompare(a.name, b.name))
    .slice(0, limit)
}

// The keys that still lead somewhere: append this key to the query and at least one
// game still matches. Everything else is dimmed — "predictive" dead-key dimming,
// the thing that stops you typing yourself into an empty list one careful press at
// a time.
//
// For a non-empty query, a key K is live exactly when `query + K` is a substring of
// some title — i.e. some title has the query immediately followed by K — so we walk
// each occurrence of the query and collect the character that follows it. For an
// empty query every character that appears anywhere is live (there's nothing yet to
// extend, so any first letter that exists in the library is fair game).
export function liveKeys(items = [], query) {
  const q = (query || '').toLowerCase()
  const live = new Set()
  for (const g of items) {
    const name = (g.name || '').toLowerCase()
    if (!q) {
      for (const ch of name) live.add(ch.toUpperCase())
      continue
    }
    let at = name.indexOf(q)
    while (at !== -1) {
      const next = name[at + q.length]
      if (next) live.add(next.toUpperCase())
      at = name.indexOf(q, at + 1)
    }
  }
  return live
}

// Moving the cursor around the 6×6 grid.
//
// Left/right/up wrap — the grid is a torus, so you never hit a wall and the shortest
// path to any key is always available. DOWN is the one exception: from the bottom
// row it doesn't wrap to the top, it LEAVES — that's the gesture that carries you
// out of the keyboard and into the results you've been narrowing. Returns either a
// new grid index, or `{ exit: 'results' }`.
export function gridMove(index, action, total = KEYS.length, cols = COLS) {
  switch (action) {
    case 'left':
      return { index: (index + total - 1) % total }
    case 'right':
      return { index: (index + 1) % total }
    case 'up': {
      const up = index - cols
      return { index: up < 0 ? up + total : up }
    }
    case 'down': {
      const down = index + cols
      return down >= total ? { exit: 'results' } : { index: down }
    }
    default:
      return { index }
  }
}
