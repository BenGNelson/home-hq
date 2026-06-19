import { describe, it, expect } from 'vitest'
import { groupModules, activeModule, FOOTER_GROUP } from './nav.js'

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

describe('activeModule', () => {
  const mods = [
    { id: 'dashboard', path: '/dashboard', label: 'Dashboard' },
    { id: 'plex', path: '/plex', label: 'Plex' },
    { id: 'plex-insights', path: '/plex/insights', label: 'Plex Insights' },
    { id: 'library', path: '/library', label: 'Library' },
    { id: 'api', path: '/api/docs', label: 'API', external: true },
  ]

  it('matches an exact route', () => {
    expect(activeModule(mods, '/dashboard').id).toBe('dashboard')
  })

  it('resolves a deep route to its section by prefix', () => {
    expect(activeModule(mods, '/plex/movie/123').id).toBe('plex')
    expect(activeModule(mods, '/library/books').id).toBe('library')
  })

  it('prefers the longest matching prefix (specific over parent)', () => {
    expect(activeModule(mods, '/plex/insights').id).toBe('plex-insights')
  })

  it('never matches an external link or an unknown route', () => {
    expect(activeModule(mods, '/api/docs')).toBeNull()
    expect(activeModule(mods, '/nope')).toBeNull()
  })

  it('does not treat a sibling prefix as a match (/plexier ≠ /plex)', () => {
    expect(activeModule(mods, '/plexier')).toBeNull()
  })
})
