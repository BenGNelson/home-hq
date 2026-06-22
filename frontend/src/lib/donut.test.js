import { describe, it, expect } from 'vitest'
import { segmentsToArcs } from './donut.js'

// Pull the large-arc flag out of a slice path (the `A rx ry rot LARGE SWEEP x y`
// command). We assert on the flag's presence, not on float coordinates (brittle).
function firstLargeArcFlag(d) {
  const m = d.match(/A [\d.]+ [\d.]+ \d ([01]) [01]/)
  return m ? m[1] : null
}

describe('segmentsToArcs', () => {
  it('returns [] for empty / non-array input', () => {
    expect(segmentsToArcs([])).toEqual([])
    expect(segmentsToArcs(undefined)).toEqual([])
    expect(segmentsToArcs(null)).toEqual([])
  })

  it('returns [] when every value is zero (nothing to draw)', () => {
    expect(segmentsToArcs([{ label: 'a', value: 0 }, { label: 'b', value: 0 }])).toEqual([])
  })

  it('treats negative / NaN values as zero', () => {
    // Only the positive one survives → single segment → full ring at pct 1.
    const arcs = segmentsToArcs([
      { label: 'bad', value: -5, color: '#000' },
      { label: 'nan', value: NaN, color: '#111' },
      { label: 'good', value: 10, color: '#222' },
    ])
    expect(arcs).toHaveLength(1)
    expect(arcs[0].label).toBe('good')
    expect(arcs[0].pct).toBe(1)
  })

  it('splits 25% / 75% into two arcs with correct pct and large-arc flags', () => {
    const arcs = segmentsToArcs([
      { label: 'used', value: 25, color: '#f00' },
      { label: 'free', value: 75, color: '#0f0' },
    ])
    expect(arcs).toHaveLength(2)
    expect(arcs[0].pct).toBeCloseTo(0.25, 6)
    expect(arcs[1].pct).toBeCloseTo(0.75, 6)
    // The 25% slice is < 50% → flag 0; the 75% slice is > 50% → flag 1.
    expect(firstLargeArcFlag(arcs[0].d)).toBe('0')
    expect(firstLargeArcFlag(arcs[1].d)).toBe('1')
  })

  it('renders a single 100% segment as one full ring', () => {
    const arcs = segmentsToArcs([{ label: 'only', value: 42, color: '#abc' }])
    expect(arcs).toHaveLength(1)
    expect(arcs[0].pct).toBe(1)
    expect(typeof arcs[0].d).toBe('string')
    expect(arcs[0].d.length).toBeGreaterThan(0)
    expect(arcs[0].d.startsWith('M')).toBe(true)
  })

  it('emits a non-empty path string starting with M for each slice', () => {
    const arcs = segmentsToArcs([
      { label: 'a', value: 1 },
      { label: 'b', value: 2 },
      { label: 'c', value: 3 },
    ])
    for (const arc of arcs) {
      expect(typeof arc.d).toBe('string')
      expect(arc.d.length).toBeGreaterThan(0)
      expect(arc.d.startsWith('M')).toBe(true)
    }
  })

  it('covers the full circle: pcts sum to 1 for non-empty input', () => {
    const arcs = segmentsToArcs([
      { label: 'a', value: 3 },
      { label: 'b', value: 5 },
      { label: 'c', value: 11 },
    ])
    const sum = arcs.reduce((acc, a) => acc + a.pct, 0)
    expect(sum).toBeCloseTo(1, 6)
  })

  it('skips zero-value segments but keeps the rest proportional', () => {
    const arcs = segmentsToArcs([
      { label: 'a', value: 1 },
      { label: 'zero', value: 0 },
      { label: 'b', value: 1 },
    ])
    expect(arcs.map((a) => a.label)).toEqual(['a', 'b'])
    expect(arcs.reduce((acc, a) => acc + a.pct, 0)).toBeCloseTo(1, 6)
  })
})
