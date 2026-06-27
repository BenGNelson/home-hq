import { describe, it, expect } from 'vitest'
import { graphBounds, graphLine, graphTicks } from './graph.js'

describe('graphBounds', () => {
  it('default (zeroBaseline) keeps the 0→max axis', () => {
    expect(graphBounds([{ points: [10, 30, 20] }])).toEqual({ floor: 0, top: 30, peak: 30, low: 0 })
  })

  it('floors the top at 1 for an all-zero / empty series (no divide-by-zero axis)', () => {
    expect(graphBounds([{ points: [0, 0] }])).toEqual({ floor: 0, top: 1, peak: 1, low: 0 })
    expect(graphBounds([{ points: [] }])).toEqual({ floor: 0, top: 1, peak: 1, low: 0 })
  })

  it('coerces null / undefined / NaN points to 0 instead of poisoning the axis', () => {
    // The bug this guards: a single null point made Math.max return NaN, which
    // blanked the entire chart.
    expect(graphBounds([{ points: [1, null, 4] }]).top).toBe(4)
    expect(graphBounds([{ points: [undefined, NaN] }]).top).toBe(1)
  })

  it('empty series is a safe 0→1 axis', () => {
    expect(graphBounds([{ points: [] }], { zeroBaseline: false })).toEqual({
      floor: 0,
      top: 1,
      peak: 1,
      low: 0,
    })
  })

  it('zooms to the data when zeroBaseline is false (stable high signal)', () => {
    const { floor, top, peak, low } = graphBounds(
      [{ points: [938, 940, 942] }, { points: [936, 941] }],
      { zeroBaseline: false },
    )
    expect(peak).toBe(942) // actual max, for the label
    expect(low).toBe(936) // actual min, for the label
    expect(floor).toBeGreaterThan(0) // NOT zero-based
    expect(floor).toBeLessThan(936) // padded below the min
    expect(top).toBeGreaterThan(942) // padded above the max
  })

  it('never drops the floor below zero (pad clamped at 0)', () => {
    // low 1, top 100 → pad ~24.75 would push the floor negative; clamp to 0.
    const { floor } = graphBounds([{ points: [1, 100] }], { zeroBaseline: false })
    expect(floor).toBe(0)
  })
})

describe('graphTicks', () => {
  it('picks round, evenly-spaced values within the bounds', () => {
    // A zoomed Mbps window like the Speed chart's ~886–961.
    expect(graphTicks(886, 961, 4)).toEqual([900, 920, 940, 960])
  })

  it('snaps the step to a 1/2/2.5/5 × 10^n value', () => {
    expect(graphTicks(0, 100, 4)).toEqual([0, 25, 50, 75, 100])
    expect(graphTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10])
  })

  it('returns nothing for a non-positive range', () => {
    expect(graphTicks(5, 5, 4)).toEqual([])
    expect(graphTicks(10, 0, 4)).toEqual([])
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

  it('scales into a non-zero floor band', () => {
    // top=1000, floor=500 → span 500: 750→mid (y40), 950→0.9 (y8).
    expect(graphLine([750, 950], 1000, 80, 100, 500)).toBe('M0.00,40.00 L100.00,8.00')
  })

  it('clamps values below the floor to the bottom edge', () => {
    // 400 is below floor 500 → clamped to y=height (80).
    expect(graphLine([400, 600], 1000, 80, 100, 500)).toBe('M0.00,80.00 L100.00,64.00')
  })
})
