import { describe, it, expect } from 'vitest'
import {
  formatWatts,
  formatKwh,
  clockLabel,
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
  const power = ({ solar = 2000, grid, battery } = {}) => ({
    solar: { watts: solar, dir: 'out' },
    grid,
    battery,
    load: { watts: 1000, dir: 'in' },
  })

  it('null power → empty model', () => {
    expect(flowModel(null)).toEqual({ nodes: [], edges: [], hasBattery: false })
  })
  it('always includes the Solar → Home leg, active when producing', () => {
    const m = flowModel(power({ solar: 2000 }))
    expect(m.nodes).toContain('solar')
    expect(m.edges[0]).toMatchObject({ id: 'solar-home', tone: 'gold', active: true })
    expect(flowModel(power({ solar: 0 })).edges[0].active).toBe(false)
  })
  it('charging battery flows Solar → Battery (green, active)', () => {
    const m = flowModel(power({ battery: { watts: 1400, dir: 'charging' } }))
    expect(m.hasBattery).toBe(true)
    expect(m.nodes).toContain('battery')
    expect(m.edges.find((e) => e.id === 'solar-battery')).toMatchObject({
      from: 'solar', to: 'battery', tone: 'green', watts: 1400, active: true,
    })
  })
  it('discharging battery flows Battery → Home', () => {
    const m = flowModel(power({ battery: { watts: 800, dir: 'discharging' } }))
    expect(m.edges.find((e) => e.id === 'battery-home')).toMatchObject({
      from: 'battery', to: 'home', tone: 'green', watts: 800, active: true,
    })
  })
  it('importing grid → Grid → Home amber; exporting → Home → Grid emerald', () => {
    const imp = flowModel(power({ grid: { watts: 300, dir: 'importing' } }))
    expect(imp.edges.find((e) => e.id === 'grid-home')).toMatchObject({ tone: 'amber', active: true })
    const exp = flowModel(power({ grid: { watts: 300, dir: 'exporting' } }))
    expect(exp.edges.find((e) => e.id === 'home-grid')).toMatchObject({ tone: 'emerald', active: true })
  })
  it('idle grid is a dim slate link', () => {
    const m = flowModel(power({ grid: { watts: 0, dir: 'idle' } }))
    expect(m.edges.find((e) => e.id === 'grid-home')).toMatchObject({ tone: 'slate', active: false })
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

describe('clockLabel', () => {
  it('formats epoch ms as a compact 12-hour time', () => {
    // Build via a local Date so the test is timezone-agnostic.
    const ms = new Date(2026, 5, 24, 13, 35).getTime()
    expect(clockLabel(ms)).toBe('1:35p')
    expect(clockLabel(new Date(2026, 5, 24, 0, 5).getTime())).toBe('12:05a')
  })
  it('returns empty for null/invalid', () => {
    expect(clockLabel(null)).toBe('')
    expect(clockLabel(NaN)).toBe('')
  })
})
