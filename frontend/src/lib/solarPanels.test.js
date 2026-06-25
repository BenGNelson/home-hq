import { describe, it, expect } from 'vitest'
import { panelsPeak, panelColor, splitSets, evenCols } from './solarPanels.js'

describe('panelsPeak', () => {
  it('is the max current output, floored at 1', () => {
    expect(panelsPeak([{ watts: 120 }, { watts: 300 }, { watts: 0 }])).toBe(300)
    expect(panelsPeak([{ watts: 0 }, { watts: null }])).toBe(1) // all dark → floor
    expect(panelsPeak([])).toBe(1)
  })
})

describe('panelColor', () => {
  it('is slate when idle/none', () => {
    expect(panelColor(0, 300)).toBe('rgba(148,163,184,0.12)')
    expect(panelColor(null, 300)).toBe('rgba(148,163,184,0.12)')
  })
  it('scales amber alpha with output relative to peak', () => {
    expect(panelColor(300, 300)).toBe('rgba(245,158,11,1.00)') // best panel → full
    expect(panelColor(150, 300)).toBe('rgba(245,158,11,0.59)') // 0.18 + 0.5*0.82
  })
  it('caps alpha at 1 when a panel exceeds the reference', () => {
    expect(panelColor(600, 300)).toBe('rgba(245,158,11,1.00)')
  })
})

describe('splitSets', () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ i: i + 1 }))
  it('splits into the given set sizes by index', () => {
    const sets = splitSets(mk(29), [8, 21])
    expect(sets.map((s) => s.length)).toEqual([8, 21])
    expect(sets[0][0].i).toBe(1)
    expect(sets[1][0].i).toBe(9) // second set starts after the first 8
  })
  it('puts a count mismatch (leftover) into a trailing set', () => {
    expect(splitSets(mk(30), [8, 21]).map((s) => s.length)).toEqual([8, 21, 1])
  })
  it('drops empty sets and falls back to one set with no sizes', () => {
    expect(splitSets(mk(5), [8, 21]).map((s) => s.length)).toEqual([5]) // 2nd set empty
    expect(splitSets(mk(5), []).map((s) => s.length)).toEqual([5])
    expect(splitSets([], [8, 21])).toEqual([])
  })
})

describe('evenCols', () => {
  it('picks the largest divisor ≤ max for full rows', () => {
    expect(evenCols(8)).toBe(8) // 1 row
    expect(evenCols(21)).toBe(7) // 3 rows of 7
    expect(evenCols(12)).toBe(6)
  })
  it('falls back to max columns for a prime with no neat divisor', () => {
    expect(evenCols(13)).toBe(9) // remainder row centers
    expect(evenCols(1)).toBe(1)
  })
})
