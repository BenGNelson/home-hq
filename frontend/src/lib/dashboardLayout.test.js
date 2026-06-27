import { describe, it, expect } from 'vitest'
import { splitColumns } from './dashboardLayout.js'

describe('splitColumns', () => {
  it('routes widgets to their tagged column', () => {
    const { left, right } = splitColumns([
      { Comp: 'A', col: 'left' },
      { Comp: 'B', col: 'right' },
      { Comp: 'C', col: 'left' },
    ])
    expect(left.map((w) => w.Comp)).toEqual(['A', 'C'])
    expect(right.map((w) => w.Comp)).toEqual(['B'])
  })

  it('preserves array order within each column', () => {
    const widgets = [
      { Comp: 'sys', col: 'left' },
      { Comp: 'plex', col: 'right' },
      { Comp: 'solar', col: 'left' },
      { Comp: 'disk', col: 'right' },
    ]
    const { left, right } = splitColumns(widgets)
    // Each column keeps the relative order it had in the source list.
    expect(left.map((w) => w.Comp)).toEqual(['sys', 'solar'])
    expect(right.map((w) => w.Comp)).toEqual(['plex', 'disk'])
  })

  it('treats an untagged or unknown col as left (never drops a widget)', () => {
    const { left, right } = splitColumns([
      { Comp: 'A' }, // no col
      { Comp: 'B', col: 'middle' }, // typo'd col
      { Comp: 'C', col: 'right' },
    ])
    expect(left.map((w) => w.Comp)).toEqual(['A', 'B'])
    expect(right.map((w) => w.Comp)).toEqual(['C'])
  })

  it('handles an empty list', () => {
    expect(splitColumns([])).toEqual({ left: [], right: [] })
  })
})
