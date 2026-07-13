// The on-screen controls, as DATA.
//
// A layout is authored once in its own virtual coordinate space and letterboxed
// onto whatever screen it lands on (see touchInput.js `fitTransform`), so there
// are no per-device breakpoints and no hand-placed buttons per phone. Change a
// number here and every device follows.
//
// There is one layout PER ORIENTATION, and that isn't optional. The space's aspect
// ratio decides how much everything gets scaled down — squeeze a landscape-shaped
// layout into a portrait screen and it letterboxes to about 40%, which makes every
// control uselessly small no matter how big the numbers here are.
//
//   landscape  game full-bleed, controls floating over it at the edges
//   portrait   game across the top, controls filling the space beneath it
//
// Shape, per item:
//   frame          the button you can SEE, in layout coordinates
//   extendedEdges  invisible padding around it that still counts as a hit —
//                  bigger at the bottom, because thumbs undershoot
//   slide          this item can be rolled onto/off mid-press without lifting
//   input          the RetroPad index it presses (see retropad.js)
//   inputs         a d-pad's four indices
//   action         a UI action instead of a game button (the pause menu, FF)

import { RETROPAD } from './retropad.js'

const LANDSCAPE = { w: 1000, h: 470 }
const PORTRAIT = { w: 460, h: 1000 }

// In portrait the game gets the top of the screen and the controls get the rest.
// PlayerShell uses this to size the iframe, so the picture doesn't end up behind
// the buttons.
export const PORTRAIT_GAME_HEIGHT = '46%'

// Thumbs land low, so the bottom edge is the generous one.
//
// The rule these have to satisfy: a button's hit area may never reach into another
// button's VISIBLE frame. hitTest returns the FIRST item containing the point, so
// an intrusion doesn't split the difference — the earlier button silently swallows
// part of the later one, and you press A and get B. Extended edges overlapping each
// other in the dead space BETWEEN buttons is fine and even desirable; reaching a
// drawn button is not. There's a test for it.
const EDGES = { t: 18, r: 18, b: 26, l: 18 }
const FACE_EDGES = { t: 14, r: 14, b: 20, l: 14 }
const DPAD_EDGES = { t: 24, r: 24, b: 34, l: 24 }
const UI_EDGES = { t: 14, r: 14, b: 14, l: 14 }

const dpad = (x, y, size) => ({
  type: 'dpad',
  id: 'dpad',
  frame: { x, y, w: size, h: size },
  extendedEdges: DPAD_EDGES,
  deadzone: 0.18,
  slide: true, // the thumb slides between directions without ever lifting
  inputs: { up: RETROPAD.UP, down: RETROPAD.DOWN, left: RETROPAD.LEFT, right: RETROPAD.RIGHT },
})

const face = (id, label, input, x, y, size) => ({
  type: 'button',
  id,
  label,
  input,
  frame: { x, y, w: size, h: size },
  extendedEdges: FACE_EDGES,
  slide: true, // roll from B to A without lifting
})

const pill = (id, label, input, x, y, w = 120) => ({
  type: 'pill',
  id,
  label,
  input,
  frame: { x, y, w, h: 44 },
  extendedEdges: EDGES,
})

const shoulder = (id, label, input, x, y, w = 150) => ({
  type: 'shoulder',
  id,
  label,
  input,
  frame: { x, y, w, h: 56 },
  extendedEdges: EDGES,
})

// The two UI buttons. Deliberately NOT `slide`, and kept out of the thumb arc — a
// menu you open by accident mid-boss is worse than no menu.
const uiBtn = (id, label, action, x, y, size = 58) => ({
  type: 'ui',
  id,
  label,
  action,
  frame: { x, y, w: size, h: size },
  extendedEdges: UI_EDGES,
})

// --- landscape -------------------------------------------------------------

const L_UI = () => [uiBtn('menu', '☰', 'pauseMenu', 400, 15, 60), uiBtn('ff', '»', 'fastForward', 540, 15, 60)]
const L_PILLS = () => [
  pill('select', 'SELECT', RETROPAD.SELECT, 380, 415),
  pill('start', 'START', RETROPAD.START, 520, 415),
]
const L_SHOULDERS = () => [shoulder('l', 'L', RETROPAD.L, 30, 20), shoulder('r', 'R', RETROPAD.R, 820, 20)]
const L_DPAD = () => dpad(30, 200, 240)

// Two face buttons on the diagonal a thumb naturally rolls along.
const L_TWO = [face('b', 'B', RETROPAD.B, 760, 320, 96), face('a', 'A', RETROPAD.A, 880, 230, 96)]

// The SNES diamond.
const L_FOUR = [
  face('y', 'Y', RETROPAD.Y, 700, 233, 84),
  face('b', 'B', RETROPAD.B, 808, 341, 84),
  face('x', 'X', RETROPAD.X, 808, 125, 84),
  face('a', 'A', RETROPAD.A, 914, 233, 84),
]

// Mega Drive's three-button row.
const L_THREE = [
  face('a', 'A', RETROPAD.Y, 690, 330, 88),
  face('b', 'B', RETROPAD.B, 800, 290, 88),
  face('c', 'C', RETROPAD.A, 910, 250, 88),
]

// --- portrait ---------------------------------------------------------------
//
// Everything lives below the game. It's a narrower space, so the clusters are
// tighter — but the whole layout is scaled by the SHORT edge, so in practice these
// come out bigger on a phone than the landscape ones do.

const P_UI = () => [uiBtn('menu', '☰', 'pauseMenu', 165, 470), uiBtn('ff', '»', 'fastForward', 245, 470)]
const P_SHOULDERS = () => [
  shoulder('l', 'L', RETROPAD.L, 10, 472, 130),
  shoulder('r', 'R', RETROPAD.R, 330, 472, 130),
]
const P_PILLS = (y = 860) => [
  pill('select', 'SELECT', RETROPAD.SELECT, 90, y, 115),
  pill('start', 'START', RETROPAD.START, 250, y, 115),
]

const P_TWO = [face('b', 'B', RETROPAD.B, 240, 710, 82), face('a', 'A', RETROPAD.A, 350, 620, 82)]

const P_FOUR = [
  face('x', 'X', RETROPAD.X, 298, 580, 64),
  face('y', 'Y', RETROPAD.Y, 210, 668, 64),
  face('b', 'B', RETROPAD.B, 298, 756, 64),
  face('a', 'A', RETROPAD.A, 386, 668, 64),
]

const P_THREE = [
  face('a', 'A', RETROPAD.Y, 228, 780, 66),
  face('b', 'B', RETROPAD.B, 310, 735, 66),
  face('c', 'C', RETROPAD.A, 392, 690, 66),
]

// --- the layouts ------------------------------------------------------------

const L = (items) => ({ space: LANDSCAPE, items })
const P = (items) => ({ space: PORTRAIT, items })

// Game Boy / NES / Master System / Game Gear — d-pad + two buttons.
const TWO_BUTTON = {
  landscape: L([L_DPAD(), ...L_TWO, ...L_PILLS(), ...L_UI()]),
  portrait: P([dpad(20, 620, 190), ...P_TWO, ...P_PILLS(), ...P_UI()]),
}

// Game Boy Advance — two buttons, but it has shoulders.
const GBA = {
  landscape: L([L_DPAD(), ...L_TWO, ...L_SHOULDERS(), ...L_PILLS(), ...L_UI()]),
  portrait: P([dpad(20, 620, 190), ...P_TWO, ...P_SHOULDERS(), ...P_PILLS(), ...P_UI()]),
}

// SNES — the four-button diamond, plus shoulders.
const FOUR_BUTTON = {
  landscape: L([L_DPAD(), ...L_FOUR, ...L_SHOULDERS(), ...L_PILLS(), ...L_UI()]),
  portrait: P([dpad(20, 620, 160), ...P_FOUR, ...P_SHOULDERS(), ...P_PILLS(), ...P_UI()]),
}

// Mega Drive / Genesis — a three-button row, A-B-C left to right.
//
// The RetroPad indices are genesis_plus_gx's mapping (MD A = RetroPad Y, MD B =
// RetroPad B, MD C = RetroPad A) — the one binding in this file I could not
// confirm from source, so it's worth a look in an actual Genesis game.
const SEGA_MD = {
  landscape: L([L_DPAD(), ...L_THREE, pill('start', 'START', RETROPAD.START, 450, 415), ...L_UI()]),
  portrait: P([dpad(20, 620, 170), ...P_THREE, pill('start', 'START', RETROPAD.START, 170, 900, 115), ...P_UI()]),
}

const LAYOUTS = {
  gb: TWO_BUTTON,
  nes: TWO_BUTTON,
  segaMS: TWO_BUTTON,
  segaGG: TWO_BUTTON,
  gba: GBA,
  snes: FOUR_BUTTON,
  segaMD: SEGA_MD,
}

// Falls back to the two-button layout for anything unknown: a d-pad, A, B and Start
// will get you into almost any retro game, which beats no controls at all.
export function layoutFor(core, orientation = 'landscape') {
  const set = LAYOUTS[core] || TWO_BUTTON
  return orientation === 'portrait' ? set.portrait : set.landscape
}

export const CORES = Object.keys(LAYOUTS)
export const ORIENTATIONS = ['landscape', 'portrait']
