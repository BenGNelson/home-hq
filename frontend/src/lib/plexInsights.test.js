import { describe, it, expect } from 'vitest'
import { formatHour, formatShare, formatMbps } from './plexInsights.js'

describe('plex insights formatters', () => {
  it('formats a UTC hour', () => {
    expect(formatHour(0)).toBe('00:00 UTC')
    expect(formatHour(20)).toBe('20:00 UTC')
    expect(formatHour(null)).toBe('—')
  })

  it('formats a fraction as a percent', () => {
    expect(formatShare(0.5)).toBe('50%')
    expect(formatShare(0.333)).toBe('33%')
    expect(formatShare(null)).toBe('—')
  })

  it('formats kbps as Mbps', () => {
    expect(formatMbps(8000)).toBe('8.0 Mbps')
    expect(formatMbps(null)).toBe('—')
  })
})
