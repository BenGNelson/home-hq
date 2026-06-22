import { describe, it, expect } from 'vitest'
import { formatWatts, formatKwh, netLabel, solarUnavailableMessage } from './solar.js'

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
