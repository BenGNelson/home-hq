import { describe, it, expect } from 'vitest'
import { healthAccent } from './health.js'

describe('healthAccent', () => {
  it('is emerald when every metric is calm', () => {
    expect(healthAccent(20, 30)).toBe('52,211,153')
  })
  it('turns amber once the worst metric is stressed (>=75)', () => {
    expect(healthAccent(20, 80)).toBe('251,191,36')
    expect(healthAccent(75, 10)).toBe('251,191,36')
  })
  it('turns rose when the worst metric is critical (>=90)', () => {
    expect(healthAccent(95, 30)).toBe('248,113,113')
  })
  it('keys off the WORST metric, not an average', () => {
    // A nearly-full disk (92%) must read critical even if memory is low (10%).
    expect(healthAccent(10, 92)).toBe('248,113,113')
  })
  it('ignores null/NaN metrics and defaults to healthy with none', () => {
    expect(healthAccent(null, undefined, NaN)).toBe('52,211,153')
    expect(healthAccent(40, null)).toBe('52,211,153')
  })
})
