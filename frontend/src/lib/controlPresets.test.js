import { describe, it, expect } from 'vitest'
import {
  SCHEMES,
  DEFAULT_SCHEME,
  BINDABLE,
  resolveBindings,
  buildControls,
  describeBinding,
  EJS_BUTTONS_OFF,
  EJS_HIDE_SETTINGS,
} from './controlPresets.js'
import { RETROPAD } from './retropad.js'

// Physical buttons, as the browser's standard mapping reports them:
//   BUTTON_1 = bottom (Xbox A)   BUTTON_2 = right (Xbox B)
//   BUTTON_3 = left   (Xbox X)   BUTTON_4 = top   (Xbox Y)

describe('the two schemes', () => {
  it('defaults to matching the LETTERS', () => {
    // Nintendo's confirm is A; Xbox's confirm is A. Keeping the letters means the
    // button that says A always means "yes" — in Pokémon and in our own menus.
    // Ben asked for this explicitly, and it's what EmulatorJS shipped.
    expect(DEFAULT_SCHEME).toBe('letters')

    const map = resolveBindings({ scheme: 'letters' })
    expect(map[RETROPAD.A]).toBe('BUTTON_1') // press A, the game gets A
    expect(map[RETROPAD.B]).toBe('BUTTON_2')
    expect(map[RETROPAD.X]).toBe('BUTTON_3')
    expect(map[RETROPAD.Y]).toBe('BUTTON_4')
  })

  it('can instead match the POSITIONS', () => {
    // The other half of the trade: the bottom button stays the bottom button, so
    // Mario's jump (B) is under the thumb — at the cost of confirming with B.
    const map = resolveBindings({ scheme: 'positions' })
    expect(map[RETROPAD.B]).toBe('BUTTON_1') // bottom -> bottom
    expect(map[RETROPAD.A]).toBe('BUTTON_2') // right  -> right
    expect(map[RETROPAD.Y]).toBe('BUTTON_3')
    expect(map[RETROPAD.X]).toBe('BUTTON_4')
  })

  it('really is a swap — the two disagree about every face button', () => {
    // If these ever coincided, one of the schemes would be pointless.
    const letters = resolveBindings({ scheme: 'letters' })
    const positions = resolveBindings({ scheme: 'positions' })
    for (const index of [RETROPAD.A, RETROPAD.B, RETROPAD.X, RETROPAD.Y]) {
      expect(letters[index]).not.toBe(positions[index])
    }
  })

  it('agrees about everything that is not a face button', () => {
    const letters = resolveBindings({ scheme: 'letters' })
    const positions = resolveBindings({ scheme: 'positions' })
    for (const index of [RETROPAD.UP, RETROPAD.L, RETROPAD.R, RETROPAD.SELECT]) {
      expect(letters[index]).toBe(positions[index])
    }
  })

  it('falls back to the default for a scheme it has never heard of', () => {
    expect(resolveBindings({ scheme: 'nonsense' })).toEqual(resolveBindings({ scheme: DEFAULT_SCHEME }))
    expect(resolveBindings()).toEqual(resolveBindings({ scheme: DEFAULT_SCHEME }))
  })
})

describe('START', () => {
  it.each(Object.keys(SCHEMES))('is never bound to the pad (%s)', (scheme) => {
    // The app owns the controller's Menu button: short press = START, long press =
    // the pause menu. Bound here as well, every long press would open the menu AND
    // hit START, leaving the game's own pause screen sitting underneath ours.
    expect(resolveBindings({ scheme })[RETROPAD.START]).toBe('')
  })

  it('cannot be rebound from the Controls screen either', () => {
    expect(BINDABLE.some((b) => b.index === RETROPAD.START)).toBe(false)
  })
})

describe('custom bindings', () => {
  it('override the scheme, one button at a time', () => {
    const map = resolveBindings({ scheme: 'letters', custom: { [RETROPAD.A]: 'BUTTON_4' } })
    expect(map[RETROPAD.A]).toBe('BUTTON_4') // rebound
    expect(map[RETROPAD.B]).toBe('BUTTON_2') // untouched
  })

  it('survive a scheme change — they were a deliberate choice', () => {
    const custom = { [RETROPAD.L]: 'RIGHT_BOTTOM_SHOULDER' }
    for (const scheme of Object.keys(SCHEMES)) {
      expect(resolveBindings({ scheme, custom })[RETROPAD.L]).toBe('RIGHT_BOTTOM_SHOULDER')
    }
  })
})

describe('buildControls', () => {
  it('gives EmulatorJS the shape it wants', () => {
    const controls = buildControls({ scheme: 'letters' })
    expect(Object.keys(controls)).toEqual(['0', '1', '2', '3']) // four players
    expect(controls[1]).toEqual({}) // only player 1 is preset
    expect(controls[0][RETROPAD.A]).toEqual({ value: 'z', value2: 'BUTTON_1' })
  })

  it('keeps the keyboard on the engine defaults, so desktop play is unchanged', () => {
    const p = buildControls({ scheme: 'positions' })[0]
    expect(p[RETROPAD.B].value).toBe('x')
    expect(p[RETROPAD.START].value).toBe('enter')
    expect(p[RETROPAD.UP].value).toBe('up arrow')
  })

  it('carries a custom binding through to the engine', () => {
    const p = buildControls({ scheme: 'letters', custom: { [RETROPAD.A]: 'BUTTON_2' } })[0]
    expect(p[RETROPAD.A].value2).toBe('BUTTON_2')
  })
})

describe('describeBinding', () => {
  it('says where the button IS, not just what it is called', () => {
    // "A" alone is a lie on half the controllers in the world.
    expect(describeBinding('BUTTON_1')).toBe('A (bottom)')
    expect(describeBinding('BUTTON_2')).toBe('B (right)')
  })

  it('shows an unbound button as a dash', () => {
    expect(describeBinding('')).toBe('—')
    expect(describeBinding(undefined)).toBe('—')
  })

  it('passes through a name it does not recognise rather than hiding it', () => {
    expect(describeBinding('GAMEPAD_17')).toBe('GAMEPAD_17')
  })
})

describe('EJS_BUTTONS_OFF / EJS_HIDE_SETTINGS', () => {
  it('turns off every button on the engine’s own bar', () => {
    for (const [name, on] of Object.entries(EJS_BUTTONS_OFF)) {
      expect(on, `${name} should be off`).toBe(false)
    }
  })

  it('kills the long-press context menu, which fires mid-game on touch', () => {
    expect(EJS_BUTTONS_OFF.rightClick).toBe(false)
  })

  it('hides the settings we now own ourselves', () => {
    expect(EJS_HIDE_SETTINGS).toContain('virtual-gamepad')
  })
})
