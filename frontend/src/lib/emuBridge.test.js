import { describe, it, expect, vi } from 'vitest'
import {
  clearStartScreen,
  RETROPAD,
  DIGITAL_INPUTS,
  playerConfig,
  readHandle,
  readEmu,
  isSupportedHandle,
  attachEmu,
  press,
  tap,
  flushInputs,
  gateEngineGamepad,
} from './emuBridge.js'

// A stand-in for the player iframe. `hq` is what emulator.html puts on its
// window; pass nothing to model a frame that hasn't booted (or was torn down).
// addEventListener is there because attachEmu waits on the frame's load event.
function fakeFrame(hq) {
  const listeners = {}
  return {
    contentWindow: hq === undefined ? {} : { HQ: hq },
    addEventListener: (name, fn) => {
      listeners[name] = fn
    },
    removeEventListener: (name) => {
      delete listeners[name]
    },
    _fire: (name) => listeners[name]?.(),
  }
}

// A well-formed handle: emulator.html's real shape.
function handle(emu, whenStarted) {
  return { version: 1, emu, whenStarted: whenStarted ?? Promise.resolve(emu) }
}

// A frame whose contentWindow throws on access — what a cross-origin document
// (or a frame being removed mid-read) looks like.
const hostileFrame = {
  get contentWindow() {
    throw new Error('cross-origin')
  },
}

describe('RETROPAD', () => {
  it('puts the digital buttons in the range flushInputs clears', () => {
    for (const index of Object.values(RETROPAD)) {
      expect(index).toBeLessThan(DIGITAL_INPUTS)
    }
  })

  it('maps A to 8 and B to 0 — the indices the cores expect', () => {
    // Guards against a well-meaning "alphabetise the constants" refactor: these
    // numbers are EmulatorJS's wire format, not ours to choose.
    expect(RETROPAD.B).toBe(0)
    expect(RETROPAD.A).toBe(8)
    expect(RETROPAD.START).toBe(3)
  })
})

describe('playerConfig', () => {
  it('keeps save states in the browser', () => {
    // Downloading a .state file is the engine's default and iOS can't open one.
    expect(playerConfig().defaultOptions['save-state-location']).toBe('browser')
  })
})

describe('readHandle', () => {
  it('returns the handle the player document exposes', () => {
    const hq = handle(null)
    expect(readHandle(fakeFrame(hq))).toBe(hq)
  })

  it('returns null for a frame that has not booted yet', () => {
    expect(readHandle(fakeFrame())).toBeNull()
  })

  it('returns null rather than throwing when contentWindow is unreachable', () => {
    expect(readHandle(hostileFrame)).toBeNull()
    expect(readHandle(null)).toBeNull()
  })
})

describe('readEmu', () => {
  it('returns the live engine instance', () => {
    const emu = { started: true }
    expect(readEmu(fakeFrame(handle(emu)))).toBe(emu)
  })

  it('returns null before the engine has loaded', () => {
    // window.HQ exists from the first line of the player document, but
    // EJS_emulator only appears once loader.js has run.
    expect(readEmu(fakeFrame(handle(null)))).toBeNull()
    expect(readEmu(fakeFrame())).toBeNull()
  })
})

describe('isSupportedHandle', () => {
  it('accepts the shape emulator.html actually exposes', () => {
    expect(isSupportedHandle(handle(null))).toBe(true)
  })

  it('rejects a handle with no whenStarted promise', () => {
    // This is the dangerous one. Promise.resolve(undefined) settles on the next
    // microtask, so a handle missing whenStarted would make attachEmu declare
    // the game "started" instantly — the overlay would drop over the engine's
    // Start button and iOS would never unlock audio.
    expect(isSupportedHandle({ version: 1, emu: null })).toBe(false)
    expect(isSupportedHandle({ version: 1, whenStarted: 'soon' })).toBe(false)
  })

  it('rejects a player document from a different contract version', () => {
    expect(isSupportedHandle({ version: 2, whenStarted: Promise.resolve() })).toBe(false)
    expect(isSupportedHandle(null)).toBe(false)
  })
})

describe('attachEmu', () => {
  it('resolves with the engine only after the game has started', async () => {
    const emu = { started: true }
    let start
    const whenStarted = new Promise((res) => {
      start = res
    })
    const frame = fakeFrame(handle(emu, whenStarted))

    let resolved = 'pending'
    const attached = attachEmu(frame).then((e) => {
      resolved = e
    })

    // The user hasn't tapped the engine's Start button yet. Nothing in the
    // parent may cover the player until this resolves, or iOS never unlocks
    // audio — so it must NOT resolve early.
    await Promise.resolve()
    await Promise.resolve()
    expect(resolved).toBe('pending')

    start()
    await attached
    expect(resolved).toBe(emu)
  })

  it('waits for the frame to boot instead of giving up on an empty one', async () => {
    // Called before the iframe's document has run its inline script, the handle
    // isn't there yet. Bailing out with null would mean the pause menu never
    // attaches — on every single launch.
    const frame = fakeFrame() // no HQ yet
    const emu = { started: true }

    let resolved = 'pending'
    const attached = attachEmu(frame).then((e) => {
      resolved = e
    })
    await Promise.resolve()
    expect(resolved).toBe('pending')

    frame.contentWindow.HQ = handle(emu) // the document boots…
    frame._fire('load') // …and the frame's load event fires
    await attached
    expect(resolved).toBe(emu)
  })

  it('resolves null — never hangs — when the engine fails to load', async () => {
    // loader.js 404s: emulator.html shows "engine not installed" and settles
    // whenStarted with no engine. A promise that hung here would leave the
    // caller on a spinner forever, with no error and no way forward.
    const frame = fakeFrame(handle(null, Promise.resolve(null)))
    await expect(attachEmu(frame)).resolves.toBeNull()
  })

  it('resolves null — never hangs — when the user leaves before starting the game', async () => {
    const frame = fakeFrame(handle({ started: true }, new Promise(() => {}))) // never starts
    const ctl = new AbortController()

    let resolved = 'pending'
    const attached = attachEmu(frame, { signal: ctl.signal }).then((e) => {
      resolved = e
    })
    await Promise.resolve()
    expect(resolved).toBe('pending')

    ctl.abort() // the route unmounts
    await attached
    expect(resolved).toBeNull()
  })

  it('resolves null for an already-aborted signal', async () => {
    const ctl = new AbortController()
    ctl.abort()
    await expect(attachEmu(fakeFrame(handle({})), { signal: ctl.signal })).resolves.toBeNull()
  })

  it('resolves null for an unusable frame', async () => {
    await expect(attachEmu(hostileFrame)).resolves.toBeNull()
    await expect(attachEmu(null)).resolves.toBeNull()
  })

  it('resolves null rather than attaching to an incompatible player document', async () => {
    // A new app bundle against an old cached emulator.html. Better to fall back
    // to the engine's own UI than to half-wire ours.
    const frame = fakeFrame({ version: 99, whenStarted: Promise.resolve() })
    await expect(attachEmu(frame)).resolves.toBeNull()
  })
})

describe('press / tap / flushInputs', () => {
  const fakeEmu = () => ({ gameManager: { simulateInput: vi.fn() } })

  it('holds and releases a button', () => {
    const emu = fakeEmu()
    press(emu, RETROPAD.A, true)
    press(emu, RETROPAD.A, false)
    expect(emu.gameManager.simulateInput.mock.calls).toEqual([
      [0, 8, 1],
      [0, 8, 0],
    ])
  })

  it('taps a button down then back up', () => {
    // The synthetic START we send when the pad's Menu button is short-pressed.
    const emu = fakeEmu()
    const schedule = vi.fn()
    tap(emu, RETROPAD.START, { schedule })

    expect(emu.gameManager.simulateInput).toHaveBeenCalledWith(0, 3, 1)
    expect(emu.gameManager.simulateInput).toHaveBeenCalledTimes(1) // not released yet
    schedule.mock.calls[0][0]() // fire the timer
    expect(emu.gameManager.simulateInput).toHaveBeenCalledWith(0, 3, 0)
  })

  it('releases every digital button', () => {
    // Called on resume. A button held when the pause menu opened stays latched in
    // the core otherwise, and the game comes back walking into a wall.
    const emu = fakeEmu()
    flushInputs(emu)
    expect(emu.gameManager.simulateInput).toHaveBeenCalledTimes(DIGITAL_INPUTS)
    for (let i = 0; i < DIGITAL_INPUTS; i++) {
      expect(emu.gameManager.simulateInput).toHaveBeenCalledWith(0, i, 0)
    }
  })

  it('does not throw when the engine is gone mid-teardown', () => {
    expect(() => press({}, 0, true)).not.toThrow()
    expect(press({}, 0, true)).toBe(false)
    expect(() => flushInputs(null)).not.toThrow()
  })
})

describe('gateEngineGamepad', () => {
  // The engine's GamepadHandler stores exactly ONE callback per event name, so
  // re-registering REPLACES it. We must wrap, not clobber — a clobber would kill
  // the engine's own input handling and the controller would stop working.
  function fakeGamepad() {
    const listeners = {}
    return {
      listeners,
      on(name, cb) {
        listeners[name] = cb
      },
    }
  }

  it('passes events through to the engine when not gated', () => {
    const engineHandler = vi.fn()
    const gamepad = fakeGamepad()
    gamepad.on('buttondown', engineHandler)
    const emu = { gamepad }

    gateEngineGamepad(emu, () => false)
    gamepad.listeners.buttondown({ label: 'BUTTON_1' })

    expect(engineHandler).toHaveBeenCalledWith({ label: 'BUTTON_1' })
  })

  it('swallows events while a menu is open', () => {
    // Otherwise the D-pad presses navigating the pause menu ALSO drive the
    // (paused) game underneath it.
    const engineHandler = vi.fn()
    const gamepad = fakeGamepad()
    gamepad.on('buttondown', engineHandler)

    gateEngineGamepad({ gamepad }, () => true)
    gamepad.listeners.buttondown({ label: 'BUTTON_1' })

    expect(engineHandler).not.toHaveBeenCalled()
  })

  it('wraps rather than replaces, and restores the originals', () => {
    const engineHandler = vi.fn()
    const gamepad = fakeGamepad()
    gamepad.on('buttondown', engineHandler)

    const restore = gateEngineGamepad({ gamepad }, () => false)
    expect(gamepad.listeners.buttondown).not.toBe(engineHandler) // it's the wrapper

    restore()
    expect(gamepad.listeners.buttondown).toBe(engineHandler) // the engine's own is back
  })

  it('never wraps a wrapper, so gating twice still restores cleanly', () => {
    // Gate twice (a re-render, a StrictMode double-effect, reopening the menu
    // before the first restore ran). If the second call captured the FIRST
    // call's wrapper as "the engine's handler", restoring would reinstall a gate
    // belonging to a dead menu — and the controller would stop driving the game
    // for the rest of the session, with no way back short of relaunching.
    const engineHandler = vi.fn()
    const gamepad = fakeGamepad()
    gamepad.on('buttondown', engineHandler)
    const emu = { gamepad }

    let gated = true
    gateEngineGamepad(emu, () => gated)
    const restore2 = gateEngineGamepad(emu, () => gated) // second gate, first not yet restored

    restore2()
    expect(gamepad.listeners.buttondown).toBe(engineHandler) // the engine's own, not a stale wrapper

    gated = true // even with the (dead) gate closed, the engine's handler is live
    gamepad.listeners.buttondown({ label: 'BUTTON_1' })
    expect(engineHandler).toHaveBeenCalled()
  })

  it('does not throw when there is no gamepad handler', () => {
    expect(() => gateEngineGamepad({}, () => false)()).not.toThrow()
  })
})

describe('clearStartScreen', () => {
  // A stand-in player document. No jsdom in this repo, and none needed: the whole
  // job is "find three things and remove them", which a fake can answer honestly.
  const fakeDoc = (present) => {
    const removed = []
    const node = (key) => ({ remove: () => removed.push(key) })
    return {
      removed,
      querySelector: (sel) => (present.includes(sel) ? node(sel) : null),
      getElementById: (id) => (present.includes(`#${id}`) ? node(`#${id}`) : null),
    }
  }

  it('takes the whole start layer out — card, styles, AND the engine backdrop', () => {
    // The bug: the engine removes its own Start button and nothing else. Our card
    // (with the box art) and the engine's blurred cover backdrop both stayed on top
    // of the running game, the card still bobbing on its float animation.
    const doc = fakeDoc(['.hq-start', '#hq-start-screen', '.ejs_game_background'])
    expect(clearStartScreen({ contentDocument: doc })).toBe(true)
    expect(doc.removed.sort()).toEqual(['#hq-start-screen', '.ejs_game_background', '.hq-start'])
  })

  it('is fine when there is nothing to clear (it runs on every boot)', () => {
    const doc = fakeDoc([])
    expect(clearStartScreen({ contentDocument: doc })).toBe(true)
    expect(doc.removed).toEqual([])
  })

  it('does not throw when the frame is already gone', () => {
    // Quitting mid-boot tears the iframe down under us; reading contentDocument on a
    // dead (or cross-origin) frame throws.
    expect(clearStartScreen(null)).toBe(false)
    expect(clearStartScreen({ get contentDocument() { throw new Error('gone') } })).toBe(false)
  })
})
