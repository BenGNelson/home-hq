import { describe, it, expect } from 'vitest'
import {
  DEFAULTS,
  SETTINGS_KEY,
  readSettings,
  writeSettings,
  migrateLegacyEjsKeys,
  bindingsFor,
  withBinding,
  clearBindings,
} from './playerSettings.js'

// A stand-in for localStorage, including the index-based key() walk that
// migrateLegacyEjsKeys needs.
function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial))
  return {
    get length() {
      return m.size
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
    _map: m,
  }
}

describe('readSettings', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(readSettings(fakeStorage())).toEqual(DEFAULTS)
    expect(readSettings(null)).toEqual(DEFAULTS)
  })

  it('fills in keys a newer build added', () => {
    // Settings written by an older build won't have every key. Merging (rather
    // than replacing) means an upgrade doesn't hand the player `undefined`.
    const s = fakeStorage({ [SETTINGS_KEY]: JSON.stringify({ inputMode: 'pad' }) })
    const out = readSettings(s)
    expect(out.inputMode).toBe('pad')
    expect(out.touchOpacity).toBe(DEFAULTS.touchOpacity)
  })

  it('falls back to defaults on corrupt JSON rather than throwing', () => {
    expect(readSettings(fakeStorage({ [SETTINGS_KEY]: 'not json{' }))).toEqual(DEFAULTS)
  })
})

describe('writeSettings', () => {
  it('merges a patch and persists it', () => {
    const s = fakeStorage()
    const out = writeSettings(s, { inputMode: 'touch' })
    expect(out.inputMode).toBe('touch')
    expect(out.volume).toBe(DEFAULTS.volume)
    expect(readSettings(s).inputMode).toBe('touch')
  })

  it('does not throw when storage is unavailable', () => {
    // Private mode / quota exceeded. Losing a preference must not break the game.
    const hostile = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    expect(() => writeSettings(hostile, { volume: 1 })).not.toThrow()
  })
})

describe('migrateLegacyEjsKeys', () => {
  it('removes the engine’s stale per-game settings blobs and nothing else', () => {
    const s = fakeStorage({
      'ejs-Mario-snes9x-Mario-settings': '{"controlSettings":{}}',
      'ejs-Zelda-gambatte-Zelda-settings': '{}',
      'ejs-settings': '{"volume":0.5}',
      'homehq.recentGames': '[]',
      [SETTINGS_KEY]: '{}',
    })
    expect(migrateLegacyEjsKeys(s)).toBe(3)
    expect(s.getItem('homehq.recentGames')).toBe('[]')
    expect(s.getItem(SETTINGS_KEY)).toBe('{}')
    expect(s.getItem('ejs-settings')).toBeNull()
  })

  it('deletes every matching key, not every other one', () => {
    // Removing while walking the store by index reindexes it and skips entries —
    // the classic mutate-while-iterating bug. Collect first, then delete.
    const s = fakeStorage(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`ejs-g${i}`, 'x'])))
    expect(migrateLegacyEjsKeys(s)).toBe(6)
    expect(s.length).toBe(1) // just the sweep flag
  })

  it('only runs once', () => {
    const s = fakeStorage({ 'ejs-a': '1' })
    expect(migrateLegacyEjsKeys(s)).toBe(1)
    s.setItem('ejs-b', '2') // the engine can't write these any more, but prove it
    expect(migrateLegacyEjsKeys(s)).toBe(0)
    expect(s.getItem('ejs-b')).toBe('2')
  })

  it('does not throw without storage', () => {
    expect(migrateLegacyEjsKeys(null)).toBe(0)
  })
})


describe('control bindings, per controller', () => {
  // Keyed by controller on purpose: Ben has an Xbox pad and may buy another with a
  // different layout. Remapping one must not silently rewire the other.
  const XBOX = 'Xbox Wireless Controller:0'
  const OTHER = '8BitDo SN30 Pro:0'

  it('starts with no overrides', () => {
    expect(bindingsFor(DEFAULTS, XBOX)).toEqual({})
    expect(bindingsFor(DEFAULTS, null)).toEqual({})
  })

  it('remembers a rebind against the controller it was made on', () => {
    const s = withBinding(DEFAULTS, XBOX, 8, 'BUTTON_2')
    expect(bindingsFor(s, XBOX)).toEqual({ 8: 'BUTTON_2' })
    expect(bindingsFor(s, OTHER)).toEqual({}) // the other pad is untouched
  })

  it('keeps each controller’s map separate', () => {
    let s = withBinding(DEFAULTS, XBOX, 8, 'BUTTON_2')
    s = withBinding(s, OTHER, 8, 'BUTTON_4')
    expect(bindingsFor(s, XBOX)[8]).toBe('BUTTON_2')
    expect(bindingsFor(s, OTHER)[8]).toBe('BUTTON_4')
  })

  it('layers several rebinds on one controller', () => {
    let s = withBinding(DEFAULTS, XBOX, 8, 'BUTTON_2')
    s = withBinding(s, XBOX, 0, 'BUTTON_1')
    expect(bindingsFor(s, XBOX)).toEqual({ 0: 'BUTTON_1', 8: 'BUTTON_2' })
  })

  it('resets one controller without touching the others', () => {
    let s = withBinding(DEFAULTS, XBOX, 8, 'BUTTON_2')
    s = withBinding(s, OTHER, 8, 'BUTTON_4')
    s = clearBindings(s, XBOX)
    expect(bindingsFor(s, XBOX)).toEqual({})
    expect(bindingsFor(s, OTHER)[8]).toBe('BUTTON_4')
  })

  it('does nothing when there is no controller to key against', () => {
    expect(withBinding(DEFAULTS, null, 8, 'BUTTON_2')).toBe(DEFAULTS)
  })

  it('round-trips through storage', () => {
    const store = fakeStorage()
    writeSettings(store, withBinding(DEFAULTS, XBOX, 8, 'BUTTON_2'))
    expect(bindingsFor(readSettings(store), XBOX)).toEqual({ 8: 'BUTTON_2' })
  })
})
