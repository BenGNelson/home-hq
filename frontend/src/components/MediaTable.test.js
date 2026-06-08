import { describe, it, expect } from 'vitest'
import { compare } from './MediaTable.jsx'

describe('compare (table sorter)', () => {
  it('orders numbers ascending and descending', () => {
    expect(compare(1, 2, 'asc')).toBeLessThan(0)
    expect(compare(2, 1, 'asc')).toBeGreaterThan(0)
    expect(compare(1, 2, 'desc')).toBeGreaterThan(0)
  })

  it('orders strings case-insensitively via localeCompare', () => {
    expect(compare('apple', 'banana', 'asc')).toBeLessThan(0)
    expect(compare('banana', 'apple', 'asc')).toBeGreaterThan(0)
  })

  it('always sorts null/empty last, regardless of direction', () => {
    expect(compare(null, 5, 'asc')).toBe(1)
    expect(compare(5, null, 'asc')).toBe(-1)
    expect(compare(null, 5, 'desc')).toBe(1) // still last on desc
    expect(compare('', 'x', 'asc')).toBe(1)
    expect(compare(null, null, 'asc')).toBe(0)
  })
})
