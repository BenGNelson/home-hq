import { describe, it, expect } from 'vitest'
import {
  formatWatts,
  formatKwh,
  netLabel,
  solarUnavailableMessage,
  gaugeFraction,
  glowIntensity,
  flowModel,
  barPair,
  sunGlowFilter,
  SOLAR_REF_PEAK,
} from './solar.js'

describe('formatWatts', () => {
  it('uses W under 1000 and kW above, preserving sign', () => {
    expect(formatWatts(null)).toBe('—')
    expect(formatWatts(0)).toBe('0 W')
    expect(formatWatts(840.6)).toBe('841 W')
    expect(formatWatts(3450)).toBe('3.45 kW')
    expect(formatWatts(-1300)).toBe('-1.30 kW')
  })
})

describe('formatKwh', () => {
  it('converts Wh to kWh with one decimal', () => {
    expect(formatKwh(null)).toBe('—')
    expect(formatKwh(5040)).toBe('5.0 kWh')
    expect(formatKwh(9_000_000)).toBe('9000.0 kWh')
  })
})

describe('netLabel', () => {
  it('labels export/import/balanced by sign', () => {
    expect(netLabel(null)).toBe(null)
    expect(netLabel(1800).text).toBe('Exporting 1.80 kW')
    expect(netLabel(-450).text).toBe('Importing 450 W')
    expect(netLabel(0).text).toBe('Balanced')
  })
})

describe('solarUnavailableMessage', () => {
  it('maps each reason', () => {
    expect(solarUnavailableMessage('not_configured')).toMatch(/configured/)
    expect(solarUnavailableMessage('unreachable')).toMatch(/reach/)
    expect(solarUnavailableMessage('whatever')).toMatch(/unavailable/)
  })
})

describe('gaugeFraction', () => {
  it('is the clamped ratio of watts to the reference peak', () => {
    expect(gaugeFraction(0)).toBe(0)
    expect(gaugeFraction(null)).toBe(0)
    expect(gaugeFraction(-100)).toBe(0)
    expect(gaugeFraction(3000, 6000)).toBe(0.5)
    expect(gaugeFraction(9000, 6000)).toBe(1) // clamped
  })
  it('falls back to the default peak for a bad refPeak', () => {
    expect(gaugeFraction(SOLAR_REF_PEAK, 0)).toBe(1)
    expect(gaugeFraction(SOLAR_REF_PEAK, -5)).toBe(1)
  })
})

describe('glowIntensity', () => {
  it('tracks the gauge fill', () => {
    expect(glowIntensity(0)).toBe(0)
    expect(glowIntensity(3000, 6000)).toBe(0.5)
  })
})

describe('flowModel', () => {
  it('non-metered shows only the Sun → Home leg', () => {
    const m = flowModel({ watts_now: 2000 }, null, null, false)
    expect(m.metered).toBe(false)
    expect(m.nodes).toEqual(['solar', 'home'])
    expect(m.edges).toHaveLength(1)
    expect(m.edges[0]).toMatchObject({ id: 'solar-home', tone: 'gold', active: true })
  })
  it('idle production marks the solar leg inactive', () => {
    const m = flowModel({ watts_now: 0 }, null, null, false)
    expect(m.edges[0].active).toBe(false)
  })
  it('metered + exporting adds an active Home → Grid emerald edge', () => {
    const m = flowModel({ watts_now: 3000 }, { watts_now: 1200 }, 1800, true)
    expect(m.nodes).toContain('grid')
    const grid = m.edges.find((e) => e.id === 'home-grid')
    expect(grid).toMatchObject({ from: 'home', to: 'grid', tone: 'emerald', watts: 1800, active: true })
  })
  it('metered + importing adds an active Grid → Home amber edge with positive watts', () => {
    const m = flowModel({ watts_now: 200 }, { watts_now: 1500 }, -1300, true)
    const grid = m.edges.find((e) => e.id === 'grid-home')
    expect(grid).toMatchObject({ from: 'grid', to: 'home', tone: 'amber', watts: 1300, active: true })
  })
  it('metered + genuinely balanced (net 0) is a dim idle grid link with watts 0', () => {
    const m = flowModel({ watts_now: 1000 }, { watts_now: 1000 }, 0, true)
    const grid = m.edges.find((e) => e.id === 'grid-home')
    expect(grid).toMatchObject({ tone: 'slate', active: false, watts: 0 })
  })
  it('metered + unknown net (null) is idle with null watts, distinct from balanced', () => {
    const m = flowModel({ watts_now: 1000 }, { watts_now: null }, null, true)
    const grid = m.edges.find((e) => e.id === 'grid-home')
    expect(grid).toMatchObject({ tone: 'slate', active: false, watts: null })
  })
})

describe('sunGlowFilter', () => {
  it('grows blur + alpha with the glow level and clamps', () => {
    expect(sunGlowFilter(0)).toBe('drop-shadow(0 0 4px rgba(250,204,21,0.40))')
    expect(sunGlowFilter(1)).toBe('drop-shadow(0 0 16px rgba(250,204,21,0.90))')
    expect(sunGlowFilter(5)).toBe('drop-shadow(0 0 16px rgba(250,204,21,0.90))') // clamped
  })
  it('honors per-call base/gain knobs', () => {
    expect(sunGlowFilter(0, { baseBlur: 6, blurGain: 14, baseAlpha: 0.25 })).toBe(
      'drop-shadow(0 0 6px rgba(250,204,21,0.25))',
    )
  })
})

describe('barPair', () => {
  it('scales both bars to the larger value', () => {
    expect(barPair(8000, 4000)).toEqual({ prod: 1, cons: 0.5 })
    expect(barPair(2000, 6000)).toEqual({ prod: 1 / 3, cons: 1 })
  })
  it('returns null when neither has data', () => {
    expect(barPair(0, 0)).toBe(null)
    expect(barPair(null, undefined)).toBe(null)
  })
})
