import { describe, it, expect } from 'vitest'
import {
  resolveInputMode,
  nextPadActive,
  shouldPromptRotate,
  nextPlayerState,
  isRunning,
  isPreGame,
  isIOS,
  overlayVisible,
  supportsFullscreen,
} from './playerMode.js'

describe('resolveInputMode', () => {
  it('shows touch controls on a phone with no controller', () => {
    expect(resolveInputMode({ override: 'auto', padActive: false, hasTouch: true })).toBe('touch')
  })

  it('hides them the moment a controller is in use', () => {
    expect(resolveInputMode({ override: 'auto', padActive: true, hasTouch: true })).toBe('pad')
  })

  it('shows no on-screen controls on a desktop', () => {
    // No touchscreen and no pad = keyboard. There is nothing to draw.
    expect(resolveInputMode({ override: 'auto', padActive: false, hasTouch: false })).toBe('pad')
  })

  it('lets an explicit choice beat what is plugged in', () => {
    expect(resolveInputMode({ override: 'touch', padActive: true, hasTouch: true })).toBe('touch')
    expect(resolveInputMode({ override: 'pad', padActive: false, hasTouch: true })).toBe('pad')
  })
})

describe('nextPadActive', () => {
  it('activates on the first button press, not on a connect event', () => {
    // iOS Safari doesn't fire gamepadconnected until a button is pressed, so
    // waiting for it would leave the touch controls up over a live controller.
    expect(nextPadActive(false, 'pad-button')).toBe(true)
  })

  it('does not deactivate just because the pad went quiet', () => {
    // A controller resting on the couch through a cutscene must NOT make the
    // touch pad reappear over the game.
    expect(nextPadActive(true, 'tick')).toBe(true)
    expect(nextPadActive(true, 'idle')).toBe(true)
  })

  it('deactivates only on a real disconnect', () => {
    expect(nextPadActive(true, 'pad-disconnected')).toBe(false)
  })
})

describe('shouldPromptRotate', () => {
  it('asks a controller user to rotate', () => {
    expect(shouldPromptRotate({ mode: 'pad', portrait: true, padActive: true })).toBe(true)
  })

  it('never interrupts touch play, which has a real portrait layout', () => {
    expect(shouldPromptRotate({ mode: 'touch', portrait: true, padActive: true })).toBe(false)
  })

  it('says nothing in landscape', () => {
    expect(shouldPromptRotate({ mode: 'pad', portrait: false, padActive: true })).toBe(false)
  })

  it('does not tell a desktop user to rotate their monitor', () => {
    // A desktop browser has no touchscreen, so it resolves to mode 'pad' — but
    // there's no controller. Make the window tall and narrow and it would
    // otherwise pause the game and demand you turn your screen sideways.
    expect(shouldPromptRotate({ mode: 'pad', portrait: true, padActive: false })).toBe(false)
  })
})

describe('nextPlayerState', () => {
  it('walks boot → await-start → playing', () => {
    expect(nextPlayerState('BOOT', 'engine-loaded')).toBe('AWAIT_START')
    expect(nextPlayerState('AWAIT_START', 'started')).toBe('PLAYING')
  })

  it('does not leave AWAIT_START for anything but the start tap', () => {
    // Nothing may cover the player before the user taps the engine's own Start
    // button — on iOS that gesture is what unlocks audio, and it has to land
    // inside the player document.
    expect(nextPlayerState('AWAIT_START', 'pause')).toBe('AWAIT_START')
    expect(nextPlayerState('AWAIT_START', 'rotate-portrait')).toBe('AWAIT_START')
  })

  it('pauses, rotates and backgrounds out of PLAYING', () => {
    expect(nextPlayerState('PLAYING', 'pause')).toBe('PAUSED')
    expect(nextPlayerState('PLAYING', 'rotate-portrait')).toBe('ROTATE')
    expect(nextPlayerState('PLAYING', 'hidden')).toBe('BACKGROUNDED')
  })

  it('auto-resumes when the device is turned back to landscape', () => {
    expect(nextPlayerState('ROTATE', 'rotate-landscape')).toBe('PLAYING')
  })

  it('never auto-resumes after backgrounding — it comes back paused', () => {
    // iOS needs a fresh gesture to restart audio, and a game that un-pauses the
    // instant you switch back is a game you're already losing.
    expect(nextPlayerState('BACKGROUNDED', 'visible')).toBe('PAUSED')
  })

  it('does not let a rotation hijack the pause menu', () => {
    expect(nextPlayerState('PAUSED', 'rotate-portrait')).toBe('PAUSED')
  })

  it('treats EXITING as terminal', () => {
    expect(nextPlayerState('PLAYING', 'quit')).toBe('EXITING')
    expect(nextPlayerState('EXITING', 'started')).toBe('EXITING')
  })

  it('ignores events that do not apply', () => {
    expect(nextPlayerState('PLAYING', 'started')).toBe('PLAYING')
  })
})

describe('supportsFullscreen', () => {
  it('is false on an iPhone, where there is no Fullscreen API at all', () => {
    // The button did nothing there, which is why it isn't shown. Playing in the
    // installed PWA is already chromeless — the iPhone's version of the same thing.
    expect(supportsFullscreen({})).toBe(false)
    expect(supportsFullscreen({ fullscreenEnabled: false, webkitFullscreenEnabled: false })).toBe(false)
  })

  it('is true where fullscreen is real — desktop, and iPad behind the webkit prefix', () => {
    expect(supportsFullscreen({ fullscreenEnabled: true })).toBe(true)
    expect(supportsFullscreen({ webkitFullscreenEnabled: true })).toBe(true)
  })

  it('does not throw without a document', () => {
    expect(supportsFullscreen(null)).toBe(false)
  })
})

describe('isRunning / overlayVisible', () => {
  it('runs the core only while PLAYING', () => {
    expect(isRunning('PLAYING')).toBe(true)
    for (const s of ['BOOT', 'AWAIT_START', 'PAUSED', 'ROTATE', 'BACKGROUNDED', 'EXITING']) {
      expect(isRunning(s)).toBe(false)
    }
  })

  it('never mounts the touch overlay before the game has started', () => {
    // If it mounted early it would swallow the Start tap, and the game would
    // boot silent on iOS.
    expect(overlayVisible('AWAIT_START', 'touch')).toBe(false)
    expect(overlayVisible('PLAYING', 'touch')).toBe(true)
  })

  it('unmounts the touch overlay while paused, so it cannot desync from the core', () => {
    // Pausing releases every button in the core. The overlay keeps its own record
    // of what's held — if it survived the pause, a direction still under a finger
    // would be released in the core while the overlay still thought it was down,
    // and it would never press it again.
    expect(overlayVisible('PAUSED', 'touch')).toBe(false)
    expect(overlayVisible('ROTATE', 'touch')).toBe(false)
  })

  it('never mounts the touch overlay in controller mode', () => {
    expect(overlayVisible('PLAYING', 'pad')).toBe(false)
  })
})

describe('isPreGame', () => {
  it('is true only on the boot + start screens', () => {
    // The corner exit shows here — the only way out before the game runs.
    expect(isPreGame('BOOT')).toBe(true)
    expect(isPreGame('AWAIT_START')).toBe(true)
  })

  it('is false once the game is running or beyond', () => {
    // Once PLAYING the pause menu owns Quit, so the corner exit is hidden.
    for (const s of ['PLAYING', 'PAUSED', 'ROTATE', 'BACKGROUNDED', 'EXITING']) {
      expect(isPreGame(s)).toBe(false)
    }
  })
})

describe('isIOS', () => {
  it('spots an iPhone', () => {
    expect(isIOS({ platform: 'iPhone', maxTouchPoints: 5 })).toBe(true)
  })

  it('spots an iPadOS 13+ device (reports as MacIntel + a touch screen)', () => {
    expect(isIOS({ platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
  })

  it('does NOT flag a real Mac (MacIntel, no touch)', () => {
    // Or it would wrongly withhold pad-start on a desktop that can actually do it.
    expect(isIOS({ platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
  })

  it('does NOT flag Windows or Android', () => {
    expect(isIOS({ platform: 'Win32', maxTouchPoints: 0 })).toBe(false)
    expect(isIOS({ platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false)
  })
})
