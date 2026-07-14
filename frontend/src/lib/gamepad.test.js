import { describe, it, expect } from 'vitest'
import {
  XBOX,
  snapshotPad,
  padDiff,
  axisDirection,
  repeatTick,
  padAction,
  menuGesture,
  MENU_GESTURE_IDLE,
  bindingForButton,
} from './gamepad.js'

// A browser Gamepad, as the API hands it over.
const pad = (pressed = [], axes = [0, 0]) => ({
  id: 'Xbox Wireless Controller',
  index: 0,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
  axes,
})

describe('snapshotPad', () => {
  it('copies the button state', () => {
    // The browser mutates the Gamepad object in place between polls, so a
    // snapshot has to be a real copy or every diff comes out empty.
    const snap = snapshotPad(pad([XBOX.A]))
    expect(snap.buttons[XBOX.A]).toBe(true)
    expect(snap.buttons[XBOX.B]).toBe(false)
    expect(snap.id).toBe('Xbox Wireless Controller:0')
  })

  it('returns null for no pad', () => {
    expect(snapshotPad(null)).toBeNull()
  })
})

describe('padDiff', () => {
  it('fires once per press, not once per poll', () => {
    // The whole point. The loop runs at 60fps; a thumb rests on a button for
    // ~150ms. Without edge-triggering, one press walks the menu nine items.
    const held = snapshotPad(pad([XBOX.A]))
    expect(padDiff(null, held)).toEqual([{ button: XBOX.A, type: 'down' }])
    expect(padDiff(held, held)).toEqual([]) // still held — no new event
    expect(padDiff(held, snapshotPad(pad([])))).toEqual([{ button: XBOX.A, type: 'up' }])
  })

  it('reports several buttons at once', () => {
    const events = padDiff(null, snapshotPad(pad([XBOX.A, XBOX.MENU])))
    expect(events).toHaveLength(2)
  })
})

describe('axisDirection', () => {
  it('ignores stick drift', () => {
    // A worn stick rests off-centre. Without a deadzone the menu scrolls forever
    // while nobody is touching it.
    expect(axisDirection(0.2, -0.3)).toBeNull()
    expect(axisDirection(0, 0)).toBeNull()
  })

  it('reads a deliberate push', () => {
    expect(axisDirection(-0.9, 0)).toBe('left')
    expect(axisDirection(0.9, 0)).toBe('right')
    expect(axisDirection(0, -0.9)).toBe('up')
    expect(axisDirection(0, 0.9)).toBe('down')
  })

  it('picks one direction on a diagonal instead of chattering between two', () => {
    expect(axisDirection(0.9, 0.6)).toBe('right')
    expect(axisDirection(0.6, 0.9)).toBe('down')
  })
})

describe('repeatTick', () => {
  const held = { action: 'down', since: 1000, last: 1000, repeated: false }

  it('does not repeat immediately — a tap moves exactly one item', () => {
    expect(repeatTick(held, 1100).fire).toBe(false)
    expect(repeatTick(held, 1399).fire).toBe(false)
  })

  it('starts repeating after the initial delay', () => {
    expect(repeatTick(held, 1400).fire).toBe(true)
  })

  it('then repeats at a steady rate', () => {
    const { state } = repeatTick(held, 1400)
    expect(state.repeated).toBe(true)
    expect(repeatTick(state, 1450).fire).toBe(false) // too soon
    expect(repeatTick(state, 1510).fire).toBe(true) // 110ms later
  })

  it('does nothing when nothing is held', () => {
    expect(repeatTick(null, 5000).fire).toBe(false)
  })
})

describe('padAction', () => {
  it('maps the face buttons the way every console does', () => {
    expect(padAction(XBOX.A)).toBe('confirm')
    expect(padAction(XBOX.B)).toBe('back')
    expect(padAction(XBOX.X)).toBe('search')
    expect(padAction(XBOX.LB)).toBe('railPrev')
    expect(padAction(XBOX.RB)).toBe('railNext')
    expect(padAction(XBOX.MENU)).toBe('menu')
  })

  it('makes the triggers the fast lane through a long list', () => {
    expect(padAction(XBOX.LT)).toBe('jumpPrev')
    expect(padAction(XBOX.RT)).toBe('jumpNext')
  })

  it('ignores buttons with no meaning to a menu', () => {
    expect(padAction(XBOX.GUIDE)).toBeNull()
    expect(padAction(XBOX.VIEW)).toBeNull()
  })
})

describe('menuGesture', () => {
  // The Menu button has to do two jobs — the game needs a START, and the player
  // needs a way into the pause menu — without the two ever firing together.
  it('sends START on a short press', () => {
    let { state } = menuGesture(MENU_GESTURE_IDLE, 'down', 1000)
    const r = menuGesture(state, 'up', 1200) // 200ms
    expect(r.action).toBe('start')
  })

  it('opens the pause menu on a long press, and does NOT also send START', () => {
    // If it sent START too, you'd open the menu and find the game's own pause
    // screen sitting underneath it.
    let { state } = menuGesture(MENU_GESTURE_IDLE, 'down', 1000)

    const tick = menuGesture(state, 'tick', 1500) // 500ms — past the threshold
    expect(tick.action).toBe('pauseMenu')
    state = tick.state

    const release = menuGesture(state, 'up', 1800)
    expect(release.action).toBeNull() // no START
  })

  it('fires the menu while the button is still down, not on release', () => {
    // Waiting for the release would make the menu feel laggy.
    const { state } = menuGesture(MENU_GESTURE_IDLE, 'down', 0)
    expect(menuGesture(state, 'tick', 449).action).toBeNull()
    expect(menuGesture(state, 'tick', 450).action).toBe('pauseMenu')
  })

  it('only fires the menu once per hold', () => {
    let { state } = menuGesture(MENU_GESTURE_IDLE, 'down', 0)
    state = menuGesture(state, 'tick', 500).state
    expect(menuGesture(state, 'tick', 600).action).toBeNull()
    expect(menuGesture(state, 'tick', 900).action).toBeNull()
  })

  it('resets between presses', () => {
    let { state } = menuGesture(MENU_GESTURE_IDLE, 'down', 0)
    state = menuGesture(state, 'up', 100).state
    expect(state).toEqual(MENU_GESTURE_IDLE)

    // A second, long press still works.
    state = menuGesture(state, 'down', 200).state
    expect(menuGesture(state, 'tick', 700).action).toBe('pauseMenu')
  })
})


describe('bindingForButton', () => {
  it('names a raw button index the way the engine does', () => {
    // This is what turns "the button you just pressed" into a binding — and it
    // works for a controller we have never seen, because every modern pad reports
    // the browser's standard mapping.
    expect(bindingForButton(XBOX.A)).toBe('BUTTON_1')
    expect(bindingForButton(XBOX.B)).toBe('BUTTON_2')
    expect(bindingForButton(XBOX.LB)).toBe('LEFT_TOP_SHOULDER')
    expect(bindingForButton(XBOX.DU)).toBe('DPAD_UP')
  })

  it('refuses to hand over the Menu button', () => {
    // The app owns it: short press = the game's START, long press = the pause menu.
    // Bind it to the game as well and every long press would do both.
    expect(bindingForButton(XBOX.MENU)).toBeNull()
  })

  it('refuses the Guide button, which the OS eats anyway', () => {
    expect(bindingForButton(XBOX.GUIDE)).toBeNull()
  })
})
