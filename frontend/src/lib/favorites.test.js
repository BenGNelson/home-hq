import { describe, it, expect, beforeEach } from 'vitest'
import { getFavorites, isFavorite, addFavorite, removeFavorite, toggleFavorite } from './favorites.js'

// A tiny in-memory localStorage stand-in.
function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
  }
}

const g = (id, name = id) => ({ id, name, core: 'gb', label: 'Game Boy' })

describe('favorites', () => {
  let s
  beforeEach(() => {
    s = fakeStorage()
  })

  it('starts empty', () => {
    expect(getFavorites(s)).toEqual([])
    expect(isFavorite('x', s)).toBe(false)
  })

  it('adds a favorite and finds it', () => {
    addFavorite(g('zelda'), s)
    expect(isFavorite('zelda', s)).toBe(true)
    expect(getFavorites(s)).toHaveLength(1)
  })

  it('keeps only what it needs to launch + re-hydrate', () => {
    addFavorite({ id: 'z', name: 'Zelda', core: 'gb', label: 'Game Boy', extra: 'ignored' }, s)
    expect(getFavorites(s)[0]).toEqual({ id: 'z', name: 'Zelda', core: 'gb', label: 'Game Boy' })
  })

  it('is newest-first and de-duplicates (re-starring moves to front)', () => {
    addFavorite(g('a'), s)
    addFavorite(g('b'), s)
    addFavorite(g('a'), s)
    expect(getFavorites(s).map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('removes a favorite', () => {
    addFavorite(g('a'), s)
    removeFavorite('a', s)
    expect(isFavorite('a', s)).toBe(false)
  })

  it('toggles on then off, reporting which happened', () => {
    const on = toggleFavorite(g('a'), s)
    expect(on.favorited).toBe(true)
    expect(isFavorite('a', s)).toBe(true)

    const off = toggleFavorite(g('a'), s)
    expect(off.favorited).toBe(false)
    expect(isFavorite('a', s)).toBe(false)
  })

  it('ignores an item with no id', () => {
    expect(addFavorite({}, s)).toEqual([])
  })

  it('survives corrupt storage', () => {
    const bad = fakeStorage({ 'homehq.favorites': 'not json' })
    expect(getFavorites(bad)).toEqual([])
  })
})
