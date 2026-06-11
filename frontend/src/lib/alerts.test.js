import { describe, it, expect } from 'vitest'
import { alertEmoji } from './alerts.js'

describe('alertEmoji', () => {
  it('maps known tags', () => {
    expect(alertEmoji('floppy_disk')).toBe('💾')
    expect(alertEmoji('printer')).toBe('🖨️')
  })
  it('falls back to a bell for unknown tags', () => {
    expect(alertEmoji('nope')).toBe('🔔')
  })
})
