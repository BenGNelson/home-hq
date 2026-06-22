import { describe, it, expect } from 'vitest'
import { formatMbps, formatPing } from './speedtest.js'

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
