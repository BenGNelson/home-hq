import { describe, it, expect } from 'vitest'
import {
  resolveInputMode,
  nextPadActive,
  shouldPromptRotate,
  nextPlayerState,
  isRunning,
  overlayVisible,
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
    expect(shouldPromptRotate({ mode: 'pad', portrait: true })).toBe(true)
  })

  it('never interrupts touch play, which has a real portrait layout', () => {
    expect(shouldPromptRotate({ mode: 'touch', portrait: true })).toBe(false)
  })

  it('says nothing in landscape', () => {
    expect(shouldPromptRotate({ mode: 'pad', portrait: false })).toBe(false)
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

  it('never mounts the touch overlay in controller mode', () => {
    expect(overlayVisible('PLAYING', 'pad')).toBe(false)
  })
})
