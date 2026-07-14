import { describe, it, expect } from 'vitest'
import { windowRange, spacers } from './windowRange.js'

// The real case: 496 Game Boy Color games, 144px per tile, a 1200px-wide rail.
const RAIL = { count: 496, step: 144, viewportWidth: 1200 }

describe('windowRange', () => {
  it('renders a handful of tiles, not five hundred', () => {
    // The whole point. Mounting every tile is what made Big Picture stutter.
    const { start, end } = windowRange({ ...RAIL, scrollLeft: 0 })
    expect(start).toBe(0)
    expect(end - start + 1).toBeLessThan(30)
  })

  it('follows the scroll position', () => {
    const { start, end } = windowRange({ ...RAIL, scrollLeft: 144 * 100 })
    expect(start).toBeLessThanOrEqual(100)
    expect(end).toBeGreaterThanOrEqual(100 + Math.floor(1200 / 144))
  })

  it('keeps a buffer either side, so a scroll does not reveal blanks', () => {
    const { start } = windowRange({ ...RAIL, scrollLeft: 144 * 50, buffer: 4 })
    expect(start).toBe(46)
  })

  it('ALWAYS includes the focused tile, even if it is nowhere near the viewport', () => {
    // The controller can jump focus anywhere. The tile has to EXIST before anything
    // can scroll it into view — if it isn't rendered, scrollIntoView has nothing to
    // scroll to and the cursor vanishes.
    const { start, end } = windowRange({ ...RAIL, scrollLeft: 0, focusIndex: 400 })
    expect(start).toBeLessThanOrEqual(400)
    expect(end).toBeGreaterThanOrEqual(400)
  })

  it('never runs off either end of the rail', () => {
    expect(windowRange({ ...RAIL, scrollLeft: 0 }).start).toBe(0)
    expect(windowRange({ ...RAIL, scrollLeft: 144 * 10_000 }).end).toBe(495)
  })

  it('renders a short rail whole', () => {
    const { start, end } = windowRange({ count: 3, step: 144, viewportWidth: 1200, scrollLeft: 0 })
    expect(start).toBe(0)
    expect(end).toBe(2)
  })

  it('has nothing to say about an empty rail', () => {
    expect(windowRange({ count: 0, step: 144, viewportWidth: 1200 })).toEqual({ start: 0, end: -1 })
  })
})

describe('spacers', () => {
  it('stands in for exactly the tiles that are not rendered', () => {
    // If this is wrong the scrollbar lies and the rail jumps under your thumb.
    const { before, after } = spacers({ count: 496, start: 50, end: 60, step: 144 })
    expect(before).toBe(50 * 144)
    expect(after).toBe((496 - 1 - 60) * 144)
  })

  it('needs no spacers when the whole rail is rendered', () => {
    expect(spacers({ count: 3, start: 0, end: 2, step: 144 })).toEqual({ before: 0, after: 0 })
  })

  it('never goes negative', () => {
    const { after } = spacers({ count: 5, start: 0, end: 99, step: 144 })
    expect(after).toBe(0)
  })
})
