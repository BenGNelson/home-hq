// How a physical controller maps onto the game.
//
// EmulatorJS speaks "RetroPad" — an abstract SNES-shaped pad that every core maps
// onto its own hardware. So we don't need a preset per system: we need one mapping
// from your controller to RetroPad, and per-system differences (a Game Boy has no
// X/Y) take care of themselves, because a binding the core doesn't have is simply
// never read.
//
// THE PROBLEM THIS FILE EXISTS TO SOLVE
//
// Nintendo and Xbox disagree about the face buttons, and not in a way you can
// reconcile:
//
//        Nintendo            Xbox
//          (X)               (Y)
//       (Y)   (A)         (X)   (B)
//          (B)               (A)
//
// Nintendo's confirm button is A, and it sits on the RIGHT. Xbox's confirm button
// is also A — and it sits at the BOTTOM. Same letter, different place. So you get
// to pick which one you keep, and you cannot keep both:
//
//   · match the LETTERS   — press A, the game gets A. Pokémon's "yes" is under the
//                           button that says A, and it agrees with our own menus.
//                           But Mario's jump (B) moves off the button your thumb
//                           rests on.
//   · match the POSITIONS — the bottom button stays the bottom button, so jump is
//                           where your thumb already is. But in Pokémon you confirm
//                           with the button labelled B, which reads as wrong.
//
// There's no correct answer, only a preference — which is why it's a setting, and
// why every button is remappable on top of it (see ControlsPanel).

import { RETROPAD } from './retropad.js'

// The physical buttons, as EmulatorJS's GamepadHandler names them. A pad reporting
// the browser's "standard" mapping — which an Xbox, DualSense, or 8BitDo pad all
// do — puts its face buttons at indices 0-3, so these names are about POSITION
// even though they read like Xbox letters.
export const PAD_LABELS = {
  BUTTON_1: 'A (bottom)',
  BUTTON_2: 'B (right)',
  BUTTON_3: 'X (left)',
  BUTTON_4: 'Y (top)',
  LEFT_TOP_SHOULDER: 'LB',
  RIGHT_TOP_SHOULDER: 'RB',
  LEFT_BOTTOM_SHOULDER: 'LT',
  RIGHT_BOTTOM_SHOULDER: 'RT',
  SELECT: 'View / Select',
  LEFT_STICK: 'L3',
  RIGHT_STICK: 'R3',
  DPAD_UP: 'D-pad up',
  DPAD_DOWN: 'D-pad down',
  DPAD_LEFT: 'D-pad left',
  DPAD_RIGHT: 'D-pad right',
}

export const SCHEMES = {
  letters: {
    id: 'letters',
    name: 'Match the letters',
    blurb: 'Press A and the game gets A. Confirm is where it says confirm — best for Pokémon, RPGs, and anything menu-heavy.',
    face: {
      [RETROPAD.A]: 'BUTTON_1', // A  -> A
      [RETROPAD.B]: 'BUTTON_2', // B  -> B
      [RETROPAD.X]: 'BUTTON_3', // X  -> X
      [RETROPAD.Y]: 'BUTTON_4', // Y  -> Y
    },
  },
  positions: {
    id: 'positions',
    name: 'Match the positions',
    blurb: 'The bottom button stays the bottom button, so jump is under your thumb — best for platformers. Confirm ends up on B.',
    face: {
      [RETROPAD.B]: 'BUTTON_1', // bottom -> bottom
      [RETROPAD.A]: 'BUTTON_2', // right  -> right
      [RETROPAD.Y]: 'BUTTON_3', // left   -> left
      [RETROPAD.X]: 'BUTTON_4', // top    -> top
    },
  },
}

// Letters. It agrees with the labels printed on the controller, and with our own
// menus (where A selects) — so the same button means "yes" everywhere.
export const DEFAULT_SCHEME = 'letters'

// Everything that isn't a face button is the same either way.
const SHARED = {
  [RETROPAD.SELECT]: 'SELECT',
  [RETROPAD.UP]: 'DPAD_UP',
  [RETROPAD.DOWN]: 'DPAD_DOWN',
  [RETROPAD.LEFT]: 'DPAD_LEFT',
  [RETROPAD.RIGHT]: 'DPAD_RIGHT',
  [RETROPAD.L]: 'LEFT_TOP_SHOULDER',
  [RETROPAD.R]: 'RIGHT_TOP_SHOULDER',
  [RETROPAD.L2]: 'LEFT_BOTTOM_SHOULDER',
  [RETROPAD.R2]: 'RIGHT_BOTTOM_SHOULDER',

  // START gets NO pad binding, on purpose. The app owns the controller's Menu
  // button: a short press sends a synthetic START to the game, a long press opens
  // the pause menu. Bound here as well, every long press would open the menu AND
  // hit START, leaving the game's own pause screen sitting underneath ours.
  [RETROPAD.START]: '',
}

// EmulatorJS's own keyboard defaults, kept as-is so desktop play is unchanged.
const KEYBOARD = {
  [RETROPAD.B]: 'x',
  [RETROPAD.Y]: 's',
  [RETROPAD.SELECT]: 'v',
  [RETROPAD.START]: 'enter',
  [RETROPAD.UP]: 'up arrow',
  [RETROPAD.DOWN]: 'down arrow',
  [RETROPAD.LEFT]: 'left arrow',
  [RETROPAD.RIGHT]: 'right arrow',
  [RETROPAD.A]: 'z',
  [RETROPAD.X]: 'a',
  [RETROPAD.L]: 'q',
  [RETROPAD.R]: 'e',
  [RETROPAD.L2]: 'tab',
  [RETROPAD.R2]: 'r',
}

// The buttons a player can actually rebind, in the order the Controls screen shows
// them. START is absent deliberately (see SHARED).
export const BINDABLE = [
  { index: RETROPAD.A, name: 'A' },
  { index: RETROPAD.B, name: 'B' },
  { index: RETROPAD.X, name: 'X' },
  { index: RETROPAD.Y, name: 'Y' },
  { index: RETROPAD.L, name: 'L' },
  { index: RETROPAD.R, name: 'R' },
  { index: RETROPAD.SELECT, name: 'Select' },
]

// The final RetroPad -> physical-button map: the chosen scheme, with any buttons the
// player has personally rebound layered on top.
export function resolveBindings({ scheme = DEFAULT_SCHEME, custom = {} } = {}) {
  const { face } = SCHEMES[scheme] || SCHEMES[DEFAULT_SCHEME]
  return { ...SHARED, ...face, ...custom }
}

// The shape EmulatorJS wants: { [player]: { [retropadIndex]: { value, value2 } } }.
// Only player 1 is preset; the rest stay empty, as they are by default.
export function buildControls(controls) {
  const map = resolveBindings(controls)
  const player = {}
  for (const [index, key] of Object.entries(KEYBOARD)) {
    player[index] = { value: key, value2: map[index] ?? '' }
  }
  return { 0: player, 1: {}, 2: {}, 3: {} }
}

// What a binding reads as on screen ("A (bottom)"), or "—" when it's unbound.
export function describeBinding(label) {
  if (!label) return '—'
  return PAD_LABELS[label] || label
}

// The engine's own bottom-bar buttons, all off — the HQ pause menu replaces them.
export const EJS_BUTTONS_OFF = {
  playPause: false,
  play: false,
  pause: false,
  restart: false,
  mute: false,
  unmute: false,
  settings: false,
  fullscreen: false,
  enterFullscreen: false,
  exitFullscreen: false,
  saveState: false,
  loadState: false,
  screenRecord: false,
  gamepad: false,
  cheat: false,
  volumeSlider: false,
  saveSavFiles: false,
  loadSavFiles: false,
  quickSave: false,
  quickLoad: false,
  screenshot: false,
  cacheManager: false,
  exitEmulation: false,
  netplay: false,
  diskButton: false,
  rightClick: false, // kills the long-press context menu, which fires mid-game on touch
}

// Settings we now own (they live in the HQ pause menu / player settings), hidden
// from the engine's own settings screen so there's one place to change each thing.
export const EJS_HIDE_SETTINGS = ['virtual-gamepad', 'menu-bar-button', 'virtual-gamepad-left-handed-mode']
