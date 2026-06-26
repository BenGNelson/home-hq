import { describe, it, expect } from 'vitest'
import { glowFilter, radiantBackdrop } from './glow.js'

describe('glowFilter', () => {
  it('scales blur + alpha with intensity and clamps to [0,1]', () => {
    expect(glowFilter('1,2,3', 0)).toBe('drop-shadow(0 0 4px rgba(1,2,3,0.40))')
    expect(glowFilter('1,2,3', 1)).toBe('drop-shadow(0 0 16px rgba(1,2,3,0.90))')
    expect(glowFilter('1,2,3', 5)).toBe('drop-shadow(0 0 16px rgba(1,2,3,0.90))') // clamped
  })
  it('honors per-call base/gain knobs', () => {
    expect(glowFilter('9,9,9', 0, { baseBlur: 6, blurGain: 14, baseAlpha: 0.25 })).toBe(
      'drop-shadow(0 0 6px rgba(9,9,9,0.25))',
    )
  })
})

describe('radiantBackdrop', () => {
  it('builds a transparent-fading radial gradient in the given color', () => {
    expect(radiantBackdrop('1,2,3')).toBe(
      'radial-gradient(120% 120% at 50% -10%, rgba(1,2,3,0.3), transparent 65%)',
    )
    expect(radiantBackdrop('1,2,3', 0.5)).toContain('rgba(1,2,3,0.5)')
  })
})
