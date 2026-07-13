import { describe, it, expect } from 'vitest'
import { presetFor, EJS_BUTTONS_OFF, EJS_HIDE_SETTINGS } from './controlPresets.js'
import { RETROPAD } from './retropad.js'

const CORES = ['gb', 'gba', 'nes', 'snes', 'segaMD', 'segaMS', 'segaGG']

describe('presetFor', () => {
  it.each(CORES)('maps the face buttons by POSITION, not by letter (%s)', (core) => {
    const p = presetFor(core)[0]

    // This is the whole point of the preset, and it's the assertion most likely to
    // be "corrected" by someone who reads B -> BUTTON_1 as a typo. It isn't.
    //
    // A SNES pad's B is at the BOTTOM. An Xbox pad's B is on the RIGHT, and its
    // BOTTOM button is A (= BUTTON_1). Matching them by letter — which is what
    // EmulatorJS ships — puts the jump button on the wrong side of the pad.
    expect(p[RETROPAD.B].value2).toBe('BUTTON_1') // SNES bottom <- Xbox bottom (A)
    expect(p[RETROPAD.A].value2).toBe('BUTTON_2') // SNES right  <- Xbox right  (B)
    expect(p[RETROPAD.Y].value2).toBe('BUTTON_3') // SNES left   <- Xbox left   (X)
    expect(p[RETROPAD.X].value2).toBe('BUTTON_4') // SNES top    <- Xbox top    (Y)
  })

  it.each(CORES)('leaves START unbound on the pad (%s)', (core) => {
    // The app owns the controller's Menu button: short press = START, long press =
    // the pause menu. If START were also bound here, every long press would open
    // the menu AND hit START in the game underneath it.
    expect(presetFor(core)[0][RETROPAD.START].value2).toBe('')
  })

  it('keeps the keyboard on the engine defaults so desktop play is unchanged', () => {
    const p = presetFor('snes')[0]
    expect(p[RETROPAD.B].value).toBe('x')
    expect(p[RETROPAD.A].value).toBe('z')
    expect(p[RETROPAD.START].value).toBe('enter')
    expect(p[RETROPAD.UP].value).toBe('up arrow')
  })

  it('binds the d-pad and shoulders', () => {
    const p = presetFor('snes')[0]
    expect(p[RETROPAD.UP].value2).toBe('DPAD_UP')
    expect(p[RETROPAD.RIGHT].value2).toBe('DPAD_RIGHT')
    expect(p[RETROPAD.L].value2).toBe('LEFT_TOP_SHOULDER')
    expect(p[RETROPAD.R].value2).toBe('RIGHT_TOP_SHOULDER')
    expect(p[RETROPAD.SELECT].value2).toBe('SELECT')
  })

  it('presets player 1 only, and gives the engine all four slots', () => {
    const preset = presetFor('gb')
    expect(Object.keys(preset)).toEqual(['0', '1', '2', '3'])
    expect(preset[1]).toEqual({})
  })
})

describe('EJS_BUTTONS_OFF', () => {
  it('turns off every button on the engine’s own bar', () => {
    // The HQ pause menu replaces it. Any button left on here is one the user can
    // reach behind our UI.
    for (const [name, on] of Object.entries(EJS_BUTTONS_OFF)) {
      expect(on, `${name} should be off`).toBe(false)
    }
  })

  it('kills the right-click / long-press context menu', () => {
    // On touch it fires mid-game from a long press on the screen.
    expect(EJS_BUTTONS_OFF.rightClick).toBe(false)
  })
})

describe('EJS_HIDE_SETTINGS', () => {
  it('hides the settings we now own ourselves', () => {
    expect(EJS_HIDE_SETTINGS).toContain('virtual-gamepad')
  })
})
