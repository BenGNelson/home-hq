// The controller preset we ship, so a Bluetooth pad Just Works with no remapping.
//
// EmulatorJS speaks "RetroPad" — an abstract SNES-ish pad that every core maps
// onto its own hardware. So we don't need a preset per system: we need ONE, and
// per-system differences (a Game Boy has no X/Y) take care of themselves, because
// a binding the core doesn't have is simply never read.

import { RETROPAD } from './retropad.js'

// EmulatorJS's GamepadHandler names buttons by their index in the browser's
// "standard" gamepad mapping, which an Xbox pad reports. Naming them by POSITION
// rather than by letter is the whole trick — see below.
//
//   index 0 = A (bottom)   index 1 = B (right)
//   index 2 = X (left)     index 3 = Y (top)
const PAD = {
  BOTTOM: 'BUTTON_1',
  RIGHT: 'BUTTON_2',
  LEFT: 'BUTTON_3',
  TOP: 'BUTTON_4',
  LB: 'LEFT_TOP_SHOULDER',
  RB: 'RIGHT_TOP_SHOULDER',
  LT: 'LEFT_BOTTOM_SHOULDER',
  RT: 'RIGHT_BOTTOM_SHOULDER',
  SELECT: 'SELECT',
  DPAD_UP: 'DPAD_UP',
  DPAD_DOWN: 'DPAD_DOWN',
  DPAD_LEFT: 'DPAD_LEFT',
  DPAD_RIGHT: 'DPAD_RIGHT',
}

// Map by POSITION, not by letter.
//
// Nintendo and Xbox disagree about where the letters go: a SNES pad's B is at the
// BOTTOM, an Xbox pad's B is on the RIGHT. EmulatorJS's stock table matches them
// up by name (RetroPad B <- Xbox B), which means the button under your thumb —
// the one every platformer uses to jump — ends up on the wrong side of the pad.
// Matching by position instead puts SNES B (bottom) on Xbox A (bottom), which is
// where your thumb already is, and it's what Delta and RetroArch do too.
//
// The keyboard column is EmulatorJS's own default, kept as-is so desktop play is
// unchanged.
const XBOX_BINDINGS = {
  [RETROPAD.B]: { key: 'x', pad: PAD.BOTTOM }, // bottom face button on both pads
  [RETROPAD.A]: { key: 'z', pad: PAD.RIGHT }, // right face button on both pads
  [RETROPAD.Y]: { key: 's', pad: PAD.LEFT },
  [RETROPAD.X]: { key: 'a', pad: PAD.TOP },
  [RETROPAD.SELECT]: { key: 'v', pad: PAD.SELECT },
  [RETROPAD.UP]: { key: 'up arrow', pad: PAD.DPAD_UP },
  [RETROPAD.DOWN]: { key: 'down arrow', pad: PAD.DPAD_DOWN },
  [RETROPAD.LEFT]: { key: 'left arrow', pad: PAD.DPAD_LEFT },
  [RETROPAD.RIGHT]: { key: 'right arrow', pad: PAD.DPAD_RIGHT },
  [RETROPAD.L]: { key: 'q', pad: PAD.LB },
  [RETROPAD.R]: { key: 'e', pad: PAD.RB },
  [RETROPAD.L2]: { key: 'tab', pad: PAD.LT },
  [RETROPAD.R2]: { key: 'r', pad: PAD.RT },

  // START is deliberately left with NO pad binding. The app owns the controller's
  // Menu button: a short press sends a synthetic START to the game, a long press
  // opens the HQ pause menu. Binding START here as well would make every long
  // press ALSO hit START in the game — you'd open the menu and land on the game's
  // own pause screen underneath it.
  [RETROPAD.START]: { key: 'enter', pad: '' },
}

// EmulatorJS wants { [player]: { [retropadIndex]: { value, value2 } } } for four
// players. We only preset player 1; the rest stay empty, as they are by default.
export function presetFor(_core) {
  const player = {}
  for (const [index, { key, pad }] of Object.entries(XBOX_BINDINGS)) {
    player[index] = { value: key, value2: pad }
  }
  // Per-system overrides would go here. None are needed today: RetroPad is the
  // abstraction, so a core with fewer buttons just ignores the bindings it has no
  // hardware for.
  return { 0: player, 1: {}, 2: {}, 3: {} }
}

// The engine's own bottom-bar buttons, all off — the HQ pause menu replaces them.
// (The bar is also hidden with CSS; this stops the buttons existing at all.)
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
