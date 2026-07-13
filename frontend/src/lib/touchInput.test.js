import { describe, it, expect } from 'vitest'
import { fitTransform, toVirtual, hitRect, hitTest, dpadZones, reduceTouches, diffPressed } from './touchInput.js'
import { layoutFor, CORES, ORIENTATIONS } from './touchLayouts.js'
import { RETROPAD } from './retropad.js'

const snes = layoutFor('snes', 'landscape')
const item = (id) => snes.items.find((i) => i.id === id)

// Identity transform, so tests can work in layout coordinates directly.
const ID = { scale: 1, ox: 0, oy: 0 }

// The centre of a button, in layout coordinates.
const mid = (id) => {
  const f = item(id).frame
  return { x: f.x + f.w / 2, y: f.y + f.h / 2 }
}
const touch = (id, pt) => ({ id, clientX: pt.x, clientY: pt.y })

describe('fitTransform', () => {
  it('letterboxes the layout into the viewport', () => {
    const t = fitTransform({ w: 1000, h: 460 }, { w: 2000, h: 920 })
    expect(t.scale).toBe(2)
    expect(t.ox).toBe(0)
    expect(t.oy).toBe(0)
  })

  it('keeps the controls clear of the safe area', () => {
    // Landscape on a notched phone: insets on the left/right, plus the home
    // indicator at the bottom. iOS also swallows the first swipe near that bottom
    // edge, so a button parked there feels broken. Shrinking the space away from
    // the insets means that can't happen by construction.
    const t = fitTransform({ w: 1000, h: 460 }, { w: 1000, h: 460 }, { left: 50, right: 50, bottom: 20 })
    expect(t.scale).toBeLessThan(1)
    expect(t.ox).toBeGreaterThanOrEqual(50)
  })

  it('survives a zero-size viewport instead of dividing by zero', () => {
    expect(Number.isFinite(fitTransform({ w: 1000, h: 460 }, { w: 0, h: 0 }).scale)).toBe(true)
  })
})

describe('toVirtual', () => {
  it('inverts the transform', () => {
    const t = { scale: 2, ox: 100, oy: 50 }
    expect(toVirtual(300, 150, t)).toEqual({ x: 100, y: 50 })
  })
})

describe('hitRect / hitTest', () => {
  it('makes the target bigger than the button you can see', () => {
    // Thumbs undershoot. A button that only works when hit dead-on feels broken,
    // so the visual and the hit area are deliberately different sizes.
    const b = item('b')
    const r = hitRect(b)
    expect(r.w).toBeGreaterThan(b.frame.w)
    expect(r.h).toBeGreaterThan(b.frame.h)
  })

  it('registers a press just OUTSIDE the visible button', () => {
    const b = item('b')
    const justBelow = { x: b.frame.x + b.frame.w / 2, y: b.frame.y + b.frame.h + 10 }
    expect(hitTest(snes, justBelow.x, justBelow.y)?.id).toBe('b')
  })

  it('finds nothing in empty space', () => {
    expect(hitTest(snes, 500, 220)).toBeNull() // middle of the screen — the game
  })
})

describe('dpadZones', () => {
  const dpad = item('dpad')
  const f = dpad.frame
  const at = (fx, fy) => dpadZones(dpad, f.x + f.w * fx, f.y + f.h * fy)

  it('reads a single direction', () => {
    expect(at(0.5, 0.05)).toEqual(['up'])
    expect(at(0.5, 0.95)).toEqual(['down'])
    expect(at(0.05, 0.5)).toEqual(['left'])
    expect(at(0.95, 0.5)).toEqual(['right'])
  })

  it('gives a real diagonal in the corners', () => {
    // The whole reason the d-pad is one region and not four buttons: you cannot
    // jump diagonally if up-right is a gap between two hitboxes.
    expect(at(0.1, 0.1).sort()).toEqual(['left', 'up'])
    expect(at(0.9, 0.9).sort()).toEqual(['down', 'right'])
  })

  it('has a dead centre, so a resting thumb presses nothing', () => {
    expect(at(0.5, 0.5)).toEqual([])
  })
})

describe('reduceTouches — multi-touch', () => {
  it('holds Left while B is tapped, and does not drop Left', () => {
    // The single most common thing a player does, and the thing naive per-button
    // touch handlers get wrong.
    const dpadLeft = { x: item('dpad').frame.x + 10, y: item('dpad').frame.y + item('dpad').frame.h / 2 }

    let s = reduceTouches(null, [touch(1, dpadLeft)], snes, ID)
    expect(s.pressed.has(RETROPAD.LEFT)).toBe(true)

    // Second finger taps B — Left must survive.
    s = reduceTouches(s, [touch(1, dpadLeft), touch(2, mid('b'))], snes, ID)
    expect(s.pressed.has(RETROPAD.LEFT)).toBe(true)
    expect(s.pressed.has(RETROPAD.B)).toBe(true)

    // B lifts. Left is still held.
    s = reduceTouches(s, [touch(1, dpadLeft)], snes, ID)
    expect(s.pressed.has(RETROPAD.LEFT)).toBe(true)
    expect(s.pressed.has(RETROPAD.B)).toBe(false)
  })

  it('lets a thumb roll from B to A without lifting', () => {
    let s = reduceTouches(null, [touch(1, mid('b'))], snes, ID)
    expect(s.pressed.has(RETROPAD.B)).toBe(true)

    s = reduceTouches(s, [touch(1, mid('a'))], snes, ID) // same finger, moved
    expect(s.pressed.has(RETROPAD.A)).toBe(true)
    expect(s.pressed.has(RETROPAD.B)).toBe(false)
  })

  it('lets a thumb slide around the d-pad — left to up-left to up', () => {
    const d = item('dpad').frame
    const at = (fx, fy) => ({ x: d.x + d.w * fx, y: d.y + d.h * fy })

    let s = reduceTouches(null, [touch(1, at(0.05, 0.5))], snes, ID)
    expect([...s.pressed]).toEqual([RETROPAD.LEFT])

    s = reduceTouches(s, [touch(1, at(0.1, 0.1))], snes, ID)
    expect([...s.pressed].sort()).toEqual([RETROPAD.UP, RETROPAD.LEFT].sort())

    s = reduceTouches(s, [touch(1, at(0.5, 0.05))], snes, ID)
    expect([...s.pressed]).toEqual([RETROPAD.UP])
  })

  it('keeps a non-sliding button owned even when the finger wanders off it', () => {
    // Start on the menu button, drag away, lift. It must NOT fire A on the way
    // past, and it must not lose the menu button either.
    let s = reduceTouches(null, [touch(1, mid('menu'))], snes, ID)
    expect(s.actions.has('pauseMenu')).toBe(true)

    s = reduceTouches(s, [touch(1, mid('a'))], snes, ID)
    expect(s.pressed.has(RETROPAD.A)).toBe(false) // did not steal A
    expect(s.actions.has('pauseMenu')).toBe(true) // still owns the menu button
  })

  it('releases a sliding finger that leaves every button', () => {
    let s = reduceTouches(null, [touch(1, mid('b'))], snes, ID)
    s = reduceTouches(s, [touch(1, { x: 500, y: 220 })], snes, ID) // out into the game area
    expect(s.pressed.size).toBe(0)
  })

  it('presses nothing when a touch starts on empty screen', () => {
    const s = reduceTouches(null, [touch(1, { x: 500, y: 220 })], snes, ID)
    expect(s.pressed.size).toBe(0)
    expect(Object.keys(s.owners)).toHaveLength(0)
  })

  it('works through a scaled + offset transform', () => {
    const t = { scale: 2, ox: 40, oy: 10 }
    const b = mid('b')
    const screen = { x: b.x * 2 + 40, y: b.y * 2 + 10 }
    const s = reduceTouches(null, [touch(1, screen)], snes, t)
    expect(s.pressed.has(RETROPAD.B)).toBe(true)
  })
})

describe('diffPressed', () => {
  it('emits one event per change, and nothing for a steady hold', () => {
    expect(diffPressed(new Set(), new Set([8]))).toEqual([{ index: 8, down: true }])
    expect(diffPressed(new Set([8]), new Set([8]))).toEqual([])
    expect(diffPressed(new Set([8]), new Set())).toEqual([{ index: 8, down: false }])
  })

  it('handles a press and a release in the same frame', () => {
    const events = diffPressed(new Set([0]), new Set([8]))
    expect(events).toContainEqual({ index: 8, down: true })
    expect(events).toContainEqual({ index: 0, down: false })
  })
})

describe('layoutFor', () => {
  it('gives every system a d-pad and the buttons it actually has', () => {
    for (const core of ['gb', 'gba', 'nes', 'snes', 'segaMD', 'segaMS', 'segaGG']) {
      const l = layoutFor(core)
      expect(l.items.some((i) => i.type === 'dpad'), `${core} has no d-pad`).toBe(true)
      expect(l.items.some((i) => i.action === 'pauseMenu'), `${core} has no menu button`).toBe(true)
    }
    expect(layoutFor('snes').items.some((i) => i.id === 'x')).toBe(true)
    expect(layoutFor('gb').items.some((i) => i.id === 'x')).toBe(false)
  })

  it('falls back to a usable layout for an unknown system', () => {
    const l = layoutFor('nintendo64')
    expect(l.items.some((i) => i.type === 'dpad')).toBe(true)
  })

  it('never lets one button’s hit area reach another button’s visible face', () => {
    // hitTest returns the FIRST item containing the point, so an intrusion doesn't
    // split the difference — the earlier button silently swallows part of the
    // later one, and you press A and get B. Two layouts shipped with exactly that.
    //
    // Extended edges overlapping EACH OTHER in the dead space between buttons is
    // fine (that's how a thumb-roll stays continuous); reaching a DRAWN button is
    // not. So the invariant is about visible frames, not hit rects.
    const intersects = (a, b) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

    for (const core of CORES) {
      for (const orientation of ORIENTATIONS) {
        const items = layoutFor(core, orientation).items
        for (const attacker of items) {
          for (const victim of items) {
            if (attacker === victim) continue
            expect(
              intersects(hitRect(attacker), victim.frame),
              `${core}/${orientation}: ${attacker.id}'s hit area covers part of ${victim.id}`
            ).toBe(false)
          }
        }
      }
    }
  })

  it('keeps every tap target at or above the 44pt minimum, even on the smallest phone', () => {
    // The layout is letterboxed, so the real size of a button depends on the
    // screen. The tightest case is the narrowest landscape phone (an iPhone SE at
    // 667x375), which scales everything down the most.
    //
    // What has to clear 44pt is the TAP TARGET — the hit rect — not the drawn
    // button. That's the whole point of extendedEdges: SELECT/START look like slim
    // pills but are tapped through a target nearly twice as tall.
    const MIN_TAP = 44
    // The smallest phone either way up (an iPhone SE), minus the safe-area insets.
    const VIEWPORT = { landscape: { w: 667, h: 341 }, portrait: { w: 375, h: 600 } }

    for (const core of CORES) {
      for (const orientation of ORIENTATIONS) {
        const layout = layoutFor(core, orientation)
        const { scale } = fitTransform(layout.space, VIEWPORT[orientation])
        for (const item of layout.items) {
          const r = hitRect(item)
          const where = `${core}/${orientation}/${item.id}`
          expect(r.w * scale, `${where} tap target too narrow`).toBeGreaterThanOrEqual(MIN_TAP)
          expect(r.h * scale, `${where} tap target too short`).toBeGreaterThanOrEqual(MIN_TAP)
        }
      }
    }
  })

  it('leaves real dead space between the d-pad and the face buttons', () => {
    // Ben, on a phone: pressing Right on the d-pad and B at the same time made his
    // thumbs bump. They were ~23px apart in portrait. What matters isn't the button
    // sizes — it's the gap, and specifically the gap between their HIT areas, since
    // that's the boundary a stray thumb crosses.
    const MIN_GAP = 44 // about a fingertip
    // A modern iPhone, minus the safe-area insets — the reference device.
    const VIEWPORT = { landscape: { w: 756, h: 372 }, portrait: { w: 393, h: 771 } }

    for (const core of CORES) {
      for (const orientation of ORIENTATIONS) {
        const layout = layoutFor(core, orientation)
        const { scale } = fitTransform(layout.space, VIEWPORT[orientation])
        const pad = hitRect(layout.items.find((i) => i.type === 'dpad'))
        const faces = layout.items.filter((i) => i.type === 'button').map(hitRect)
        const padRight = pad.x + pad.w
        const nearest = Math.min(...faces.map((f) => f.x)) - padRight

        expect(
          nearest * scale,
          `${core}/${orientation}: only ${Math.round(nearest * scale)}px between the d-pad and the nearest face button`
        ).toBeGreaterThanOrEqual(MIN_GAP)
      }
    }
  })

  it('keeps every button inside its coordinate space', () => {
    // A button placed off the edge would be scaled off-screen on every device.
    for (const core of ['gb', 'gba', 'snes', 'segaMD']) {
      const l = layoutFor(core)
      for (const it of l.items) {
        expect(it.frame.x, `${core}/${it.id}`).toBeGreaterThanOrEqual(0)
        expect(it.frame.x + it.frame.w, `${core}/${it.id}`).toBeLessThanOrEqual(l.space.w)
        expect(it.frame.y + it.frame.h, `${core}/${it.id}`).toBeLessThanOrEqual(l.space.h)
      }
    }
  })
})
