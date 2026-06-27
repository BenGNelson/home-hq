import { describe, it, expect } from 'vitest'
import {
  formatMbps,
  formatPing,
  SPEEDTEST_RANGES,
  DEFAULT_SPEEDTEST_RANGE,
  isSpeedtestRange,
} from './speedtest.js'

describe('formatMbps', () => {
  it('formats Mbps with one decimal, null -> dash', () => {
    expect(formatMbps(null)).toBe('—')
    expect(formatMbps(undefined)).toBe('—')
    expect(formatMbps(941.7)).toBe('941.7 Mbps')
    expect(formatMbps(0)).toBe('0.0 Mbps')
    expect(formatMbps(12)).toBe('12.0 Mbps')
  })
})

describe('formatPing', () => {
  it('formats ms with one decimal, null -> dash', () => {
    expect(formatPing(null)).toBe('—')
    expect(formatPing(undefined)).toBe('—')
    expect(formatPing(3.6)).toBe('3.6 ms')
    expect(formatPing(0)).toBe('0.0 ms')
  })
})

describe('speedtest history ranges', () => {
  it('exposes the five windows with non-empty labels', () => {
    expect(SPEEDTEST_RANGES.map((r) => r.key)).toEqual(['24h', '7d', '30d', '90d', '1y'])
    expect(SPEEDTEST_RANGES.every((r) => r.label)).toBe(true)
  })

  it('default range is one of the offered keys', () => {
    expect(isSpeedtestRange(DEFAULT_SPEEDTEST_RANGE)).toBe(true)
  })

  it('isSpeedtestRange validates keys', () => {
    expect(isSpeedtestRange('7d')).toBe(true)
    expect(isSpeedtestRange('1y')).toBe(true)
    expect(isSpeedtestRange('bogus')).toBe(false)
    expect(isSpeedtestRange(undefined)).toBe(false)
  })
})
