import { describe, it, expect } from 'vitest'
import { groupModules, FOOTER_GROUP } from './nav.js'

describe('groupModules', () => {
  it('folds a flat registry into one section per group', () => {
    const out = groupModules([
      { id: 'a', group: 'Overview' },
      { id: 'b', group: 'System' },
      { id: 'c', group: 'System' },
    ])
    expect(out).toEqual([
      { group: 'Overview', items: [{ id: 'a', group: 'Overview' }] },
      {
        group: 'System',
        items: [
          { id: 'b', group: 'System' },
          { id: 'c', group: 'System' },
        ],
      },
    ])
  })

  it('preserves the order each group first appears, not first-letter order', () => {
    const out = groupModules([
      { id: 'a', group: 'Zeta' },
      { id: 'b', group: 'Alpha' },
      { id: 'c', group: 'Zeta' },
    ])
    expect(out.map((s) => s.group)).toEqual(['Zeta', 'Alpha'])
  })

  it('keeps item order within a group', () => {
    const out = groupModules([
      { id: 'first', group: 'G' },
      { id: 'second', group: 'G' },
    ])
    expect(out[0].items.map((m) => m.id)).toEqual(['first', 'second'])
  })

  it('buckets entries without a group under the empty key', () => {
    const out = groupModules([{ id: 'x' }])
    expect(out).toEqual([{ group: '', items: [{ id: 'x' }] }])
  })

  it('returns nothing for an empty registry', () => {
    expect(groupModules([])).toEqual([])
  })

  it('names the footer group', () => {
    expect(FOOTER_GROUP).toBe('Docs')
  })
})
