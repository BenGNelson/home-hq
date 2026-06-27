import { describe, it, expect } from 'vitest'
import { moduleAccent, MODULE_ACCENT, FALLBACK_ACCENT } from './moduleAccent.js'

describe('moduleAccent', () => {
  it('returns the mapped accent for a known route', () => {
    expect(moduleAccent('/weather')).toBe('#38bdf8')
    expect(moduleAccent('/plex')).toBe('#fb7185')
    expect(moduleAccent('/solar')).toBe('#facc15')
  })

  it('falls back to the neutral accent for an unknown route', () => {
    expect(moduleAccent('/does-not-exist')).toBe(FALLBACK_ACCENT)
    expect(moduleAccent(undefined)).toBe(FALLBACK_ACCENT)
  })

  it('maps every accent to a hex color', () => {
    for (const color of Object.values(MODULE_ACCENT)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
