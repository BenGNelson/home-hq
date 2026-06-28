import { describe, it, expect } from 'vitest'
import { getRecent, recordPlayed, removeRecent } from './recentGames.js'

// A tiny in-memory stand-in for localStorage.
function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
  }
}

describe('getRecent', () => {
  it('returns [] for empty or corrupt storage', () => {
    expect(getRecent(fakeStorage())).toEqual([])
    expect(getRecent(fakeStorage({ 'homehq.recentGames': 'not json' }))).toEqual([])
  })
})

describe('recordPlayed', () => {
  it('puts the newest game first and stamps the time', () => {
    const s = fakeStorage()
    recordPlayed({ id: 'a.gba', name: 'A', core: 'gba' }, s, 1000)
    const list = recordPlayed({ id: 'b.gba', name: 'B', core: 'gba' }, s, 2000)
    expect(list.map((g) => g.id)).toEqual(['b.gba', 'a.gba'])
    expect(list[0].ts).toBe(2000)
  })

  it('dedups by id, moving a replayed game back to the front', () => {
    const s = fakeStorage()
    recordPlayed({ id: 'a.gba', name: 'A' }, s, 1000)
    recordPlayed({ id: 'b.gba', name: 'B' }, s, 2000)
    const list = recordPlayed({ id: 'a.gba', name: 'A' }, s, 3000)
    expect(list.map((g) => g.id)).toEqual(['a.gba', 'b.gba'])
    expect(list.length).toBe(2)
  })

  it('caps the list at 12', () => {
    const s = fakeStorage()
    let list
    for (let i = 0; i < 20; i++) list = recordPlayed({ id: `g${i}.gba`, name: `G${i}` }, s, i)
    expect(list.length).toBe(12)
    expect(list[0].id).toBe('g19.gba') // newest
  })

  it('ignores an item with no id', () => {
    const s = fakeStorage()
    expect(recordPlayed({}, s)).toEqual([])
  })
})

describe('removeRecent', () => {
  it('drops the game with that id and leaves the rest in order', () => {
    const s = fakeStorage()
    recordPlayed({ id: 'a.gba', name: 'A' }, s, 1000)
    recordPlayed({ id: 'b.gba', name: 'B' }, s, 2000)
    recordPlayed({ id: 'c.gba', name: 'C' }, s, 3000)
    const list = removeRecent('b.gba', s)
    expect(list.map((g) => g.id)).toEqual(['c.gba', 'a.gba'])
    expect(getRecent(s).map((g) => g.id)).toEqual(['c.gba', 'a.gba']) // persisted
  })

  it('is a no-op for an unknown id', () => {
    const s = fakeStorage()
    recordPlayed({ id: 'a.gba', name: 'A' }, s, 1000)
    expect(removeRecent('zzz.gba', s).map((g) => g.id)).toEqual(['a.gba'])
  })
})
