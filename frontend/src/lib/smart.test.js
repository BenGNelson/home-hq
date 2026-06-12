import { describe, it, expect } from 'vitest'
import { attrNote, attrHealth } from './smart.js'

describe('attrNote', () => {
  it('explains well-known attributes by id', () => {
    expect(attrNote(5)).toMatch(/remapped/)
    expect(attrNote(199)).toMatch(/cable/)
  })
  it('returns null for attributes we do not annotate', () => {
    expect(attrNote(12345)).toBeNull()
  })
})

describe('attrHealth', () => {
  it('flags failed when SMART marked it (when_failed set)', () => {
    expect(attrHealth({ when_failed: 'FAILING_NOW', value: 100, thresh: 10 })).toBe('fail')
  })
  it('warns when the normalized value has fallen to/below threshold', () => {
    expect(attrHealth({ value: 10, thresh: 10 })).toBe('warn')
    expect(attrHealth({ value: 5, thresh: 10 })).toBe('warn')
  })
  it('is ok above threshold or when threshold is informational (0)', () => {
    expect(attrHealth({ value: 100, thresh: 10 })).toBe('ok')
    expect(attrHealth({ value: 50, thresh: 0 })).toBe('ok')
  })
})
