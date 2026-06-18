import { describe, it, expect } from 'vitest'
import { getLastPage, setLastPage } from './readingProgress.js'

// A minimal in-memory localStorage stand-in.
function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  }
}

describe('readingProgress', () => {
  it('defaults to page 1 when nothing is stored', () => {
    expect(getLastPage('papers:a.pdf', fakeStorage())).toBe(1)
  })

  it('round-trips a saved page per item', () => {
    const s = fakeStorage()
    setLastPage('papers:a.pdf', 7, s)
    setLastPage('papers:b.pdf', 3, s)
    expect(getLastPage('papers:a.pdf', s)).toBe(7)
    expect(getLastPage('papers:b.pdf', s)).toBe(3)
  })

  it('ignores invalid pages and keeps the previous value', () => {
    const s = fakeStorage()
    setLastPage('papers:a.pdf', 5, s)
    setLastPage('papers:a.pdf', 0, s)
    setLastPage('papers:a.pdf', -2, s)
    setLastPage('papers:a.pdf', 1.5, s)
    expect(getLastPage('papers:a.pdf', s)).toBe(5)
  })

  it('tolerates corrupt storage', () => {
    const s = fakeStorage({ 'homehq.readingProgress': 'not json' })
    expect(getLastPage('papers:a.pdf', s)).toBe(1)
  })

  it('is a no-op without storage', () => {
    expect(setLastPage('papers:a.pdf', 4, null)).toBe(4)
    expect(getLastPage('papers:a.pdf', null)).toBe(1)
  })
})
