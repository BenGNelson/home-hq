import { describe, it, expect } from 'vitest'
import { offlineGamesToItems } from './offline.js'

describe('offlineGamesToItems', () => {
  it('keeps only downloaded games, in the shelf item shape', () => {
    const items = offlineGamesToItems([
      { key: 'games:x', section: 'games', id: 'x', name: 'Zelda', core: 'gba' },
      { key: 'books:b', section: 'books', id: 'b', name: 'A Book' },
      { key: 'emulator:engine', section: 'emulator', id: 'engine', name: 'Emulator engine' },
    ])
    expect(items).toEqual([{ id: 'x', name: 'Zelda', core: 'gba', label: 'Game Boy Advance' }])
  })

  it('derives the system label from the stored core — for every core the backend stamps', () => {
    const items = offlineGamesToItems([
      { section: 'games', id: '1', name: 'A', core: 'gb' },
      { section: 'games', id: '2', name: 'B', core: 'gba' },
      { section: 'games', id: '3', name: 'C', core: 'nes' },
      { section: 'games', id: '4', name: 'D', core: 'snes' },
      { section: 'games', id: '5', name: 'E', core: 'segaMD' },
      { section: 'games', id: '6', name: 'F', core: 'segaMS' },
      { section: 'games', id: '7', name: 'G', core: 'segaGG' },
    ])
    expect(items.map((i) => i.label)).toEqual([
      'Game Boy',
      'Game Boy Advance',
      'NES',
      'Super Nintendo',
      'Sega Genesis',
      'Sega Master System',
      'Sega Game Gear',
    ])
  })

  it('falls back to "Other" for an unknown or missing core', () => {
    const items = offlineGamesToItems([
      { section: 'games', id: '1', name: 'A', core: 'wat' },
      { section: 'games', id: '2', name: 'B' },
    ])
    expect(items.map((i) => i.label)).toEqual(['Other', 'Other'])
  })

  it('never emits a nameless or idless entry', () => {
    const items = offlineGamesToItems([
      { section: 'games', core: 'gb' }, // no id → dropped
      { section: 'games', id: 'y', core: 'gb' }, // no name → falls back to id
      null,
      undefined,
    ])
    expect(items).toEqual([{ id: 'y', name: 'y', core: 'gb', label: 'Game Boy' }])
  })

  it('is empty for empty / missing input', () => {
    expect(offlineGamesToItems([])).toEqual([])
    expect(offlineGamesToItems()).toEqual([])
  })
})
