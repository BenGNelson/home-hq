import { describe, it, expect } from 'vitest'
import { progressLabel, progressFraction } from './reading.js'

describe('progressLabel', () => {
  it('shows percent and page-of-total', () => {
    expect(progressLabel(34, 80)).toBe('43% · p. 34 of 80')
  })
  it('falls back to just the page when total is unknown', () => {
    expect(progressLabel(5, null)).toBe('p. 5')
    expect(progressLabel(5, 0)).toBe('p. 5')
  })
  it('shows a percent for an ebook (fraction only, no pages)', () => {
    expect(progressLabel(0, null, 0.57)).toBe('57%')
    expect(progressLabel(0, 0, 0)).toBe('0%')
  })
  it('prefers page/total over fraction when both are present', () => {
    expect(progressLabel(34, 80, 0.9)).toBe('43% · p. 34 of 80')
  })
})

describe('progressFraction', () => {
  it('is page / total, clamped to 0..1', () => {
    expect(progressFraction(40, 80)).toBe(0.5)
    expect(progressFraction(200, 80)).toBe(1)
    expect(progressFraction(0, 80)).toBe(0)
  })
  it('is 0 when total is unknown', () => {
    expect(progressFraction(5, null)).toBe(0)
    expect(progressFraction(5, 0)).toBe(0)
  })
  it('uses the ebook fraction when there is no total', () => {
    expect(progressFraction(0, null, 0.25)).toBe(0.25)
    expect(progressFraction(0, null, 2)).toBe(1) // clamped
  })
})
