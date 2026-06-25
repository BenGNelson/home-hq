import { describe, it, expect } from 'vitest'
import { gaugeArc } from './solarGauge.js'

describe('gaugeArc', () => {
  it('always draws the full track', () => {
    const g = gaugeArc(0)
    expect(g.track).toMatch(/^M /)
    expect(g.track).toContain('A')
  })

  it('renders no value arc at fraction 0', () => {
    expect(gaugeArc(0).value).toBe('')
  })

  it('clamps fraction into [0, 1]', () => {
    expect(gaugeArc(2).fraction).toBe(1)
    expect(gaugeArc(-1).fraction).toBe(0)
    expect(gaugeArc(0.5).fraction).toBe(0.5)
  })

  it('a near-full value arc uses the large-arc flag (sweep > 180°)', () => {
    // Track is 270°, so the full value arc must set large-arc = 1.
    const g = gaugeArc(1)
    expect(g.value).toMatch(/A [\d.]+ [\d.]+ 0 1 1/)
  })

  it('a small value arc does not use the large-arc flag', () => {
    // 10% of 270° = 27° < 180° → large-arc = 0.
    const g = gaugeArc(0.1)
    expect(g.value).toMatch(/A [\d.]+ [\d.]+ 0 0 1/)
  })

  it('respects size + thickness in the radius', () => {
    const g = gaugeArc(0.5, { size: 200, thickness: 16 })
    expect(g.radius).toBe(92) // 200/2 - 16/2
  })
})
