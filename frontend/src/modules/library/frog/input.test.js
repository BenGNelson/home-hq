import { describe, it, expect } from 'vitest'
import { defaultFrogMode, nextFrogMode, usesNativeKeyboard } from './input.js'

describe('defaultFrogMode', () => {
  it('opens in touch on a coarse pointer (phone/tablet), pad otherwise', () => {
    expect(defaultFrogMode(true)).toBe('touch')
    expect(defaultFrogMode(false)).toBe('pad')
  })
})

describe('nextFrogMode', () => {
  it('a gamepad button switches to pad, a finger switches to touch', () => {
    expect(nextFrogMode('touch', 'pad')).toBe('pad')
    expect(nextFrogMode('pad', 'touch')).toBe('touch')
  })

  it('an iPad with a controller: opens touch, becomes pad on a button, back on a tap', () => {
    let m = defaultFrogMode(true) // coarse pointer → touch
    expect(m).toBe('touch')
    m = nextFrogMode(m, 'pad') // Ben presses the Xbox pad
    expect(m).toBe('pad')
    m = nextFrogMode(m, 'touch') // ...then taps the screen
    expect(m).toBe('touch')
  })

  it('leaves the mode unchanged for anything else', () => {
    expect(nextFrogMode('pad', 'whatever')).toBe('pad')
    expect(nextFrogMode('touch', undefined)).toBe('touch')
  })
})

describe('usesNativeKeyboard', () => {
  it('is true only in touch mode — the search keyboard is the one real fork', () => {
    expect(usesNativeKeyboard('touch')).toBe(true)
    expect(usesNativeKeyboard('pad')).toBe(false)
  })
})
