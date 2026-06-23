import { describe, it, expect } from 'vitest'
import {
  categoryLabel,
  itemTags,
  matchesQuery,
  itemVisible,
  floorItemCount,
} from './catalog.js'

describe('categoryLabel', () => {
  it('maps known categories', () => {
    expect(categoryLabel('device')).toBe('Device')
    expect(categoryLabel('infrastructure')).toBe('Infrastructure')
  })
  it('capitalizes unknown ones and defaults null to Other', () => {
    expect(categoryLabel('gadget')).toBe('Gadget')
    expect(categoryLabel(null)).toBe('Other')
    expect(categoryLabel(undefined)).toBe('Other')
  })
})

describe('itemTags', () => {
  it('includes brand, distinct model, and quantity', () => {
    expect(itemTags({ brand: 'Bambu Lab', model: 'P1S' })).toEqual(['Bambu Lab', 'P1S'])
  })
  it('drops a model equal to the brand', () => {
    expect(itemTags({ brand: 'Sonos', model: 'Sonos' })).toEqual(['Sonos'])
  })
  it('formats numeric qty with × but leaves fuzzy qty alone', () => {
    expect(itemTags({ qty: '2' })).toEqual(['×2'])
    expect(itemTags({ qty: '~3' })).toEqual(['~3'])
  })
  it('is empty with nothing to show', () => {
    expect(itemTags({ name: 'X' })).toEqual([])
  })
})

describe('matchesQuery', () => {
  const item = { name: 'Bambu P1S', brand: 'Bambu Lab', notes: 'on the workbench' }
  it('matches across fields, case-insensitively', () => {
    expect(matchesQuery(item, 'bambu')).toBe(true)
    expect(matchesQuery(item, 'WORKBENCH')).toBe(true)
  })
  it('returns true for an empty query and false for a miss', () => {
    expect(matchesQuery(item, '')).toBe(true)
    expect(matchesQuery(item, 'oven')).toBe(false)
  })
})

describe('itemVisible', () => {
  const ha = { name: 'Lock', in_ha: true }
  const plain = { name: 'TV', in_ha: false, flag: false }
  const flagged = { name: 'Printer', in_ha: false, flag: true }
  it('honors the in-HA toggle', () => {
    expect(itemVisible(plain, { onlyHa: true })).toBe(false)
    expect(itemVisible(ha, { onlyHa: true })).toBe(true)
  })
  it('honors the to-confirm toggle', () => {
    expect(itemVisible(plain, { onlyFlag: true })).toBe(false)
    expect(itemVisible(flagged, { onlyFlag: true })).toBe(true)
  })
  it('combines filters with the search query', () => {
    expect(itemVisible(ha, { onlyHa: true, q: 'lock' })).toBe(true)
    expect(itemVisible(ha, { onlyHa: true, q: 'tv' })).toBe(false)
  })
})

describe('floorItemCount', () => {
  it('sums items across rooms', () => {
    const floor = { rooms: [{ items: [1, 2] }, { items: [] }, { items: [3] }] }
    expect(floorItemCount(floor)).toBe(3)
  })
  it('handles a floor with no rooms', () => {
    expect(floorItemCount({})).toBe(0)
  })
})
