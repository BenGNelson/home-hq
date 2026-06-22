import { describe, it, expect } from 'vitest'
import { graphPeak, graphLine } from './graph.js'

describe('graphPeak', () => {
  it('returns the max point across all series', () => {
    expect(graphPeak([{ points: [1, 5, 3] }, { points: [2, 9] }])).toBe(9)
  })

  it('is floored at 1 for an all-zero / empty series (no divide-by-zero axis)', () => {
    expect(graphPeak([{ points: [0, 0] }])).toBe(1)
    expect(graphPeak([{ points: [] }])).toBe(1)
  })

  it('coerces null / undefined / NaN points to 0 instead of poisoning the peak', () => {
    // The bug this guards: a single null point made Math.max return NaN, which
    // blanked the entire chart.
    expect(graphPeak([{ points: [1, null, 4] }])).toBe(4)
    expect(graphPeak([{ points: [undefined, NaN] }])).toBe(1)
  })
})

describe('graphLine', () => {
  it('returns an empty string for no points', () => {
    expect(graphLine([], 10, 80, 100)).toBe('')
  })

  it('draws a flat line for a single point', () => {
    expect(graphLine([5], 10, 80, 100)).toBe('M0,40.00 L100,40.00')
  })

  it('maps multiple points to a scaled path', () => {
    const d = graphLine([0, 10], 10, 80, 100)
    expect(d).toBe('M0.00,80.00 L100.00,0.00')
  })

  it('treats a null/undefined mid-series point as 0 without producing NaN', () => {
    const d = graphLine([10, null, 10], 10, 80, 100)
    expect(d).not.toContain('NaN')
    expect(d).toBe('M0.00,0.00 L50.00,80.00 L100.00,0.00')
  })
})
