// The on-screen controls, as DATA.
//
// A layout is authored once in its own virtual coordinate space and letterboxed
// onto whatever screen it lands on (see touchInput.js `fitTransform`), so there
// are no per-device breakpoints and no hand-placed buttons per phone. Change a
// number here and every device follows.
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

// Landscape is the real playing orientation: game full-bleed, controls floating
// over it at the edges where the thumbs already are.
const SPACE = { w: 1000, h: 460 }

const EDGES = { t: 18, r: 18, b: 26, l: 18 } // thumbs land low; give the bottom more
const DPAD_EDGES = { t: 24, r: 24, b: 34, l: 24 }

const dpad = () => ({
  type: 'dpad',
  id: 'dpad',
  frame: { x: 40, y: 210, w: 200, h: 200 },
  extendedEdges: DPAD_EDGES,
  deadzone: 0.18,
  slide: true, // the thumb slides between directions without ever lifting
  inputs: {
    up: RETROPAD.UP,
    down: RETROPAD.DOWN,
    left: RETROPAD.LEFT,
    right: RETROPAD.RIGHT,
  },
})

const face = (id, label, input, x, y, size = 78) => ({
  type: 'button',
  id,
  label,
  input,
  frame: { x, y, w: size, h: size },
  extendedEdges: EDGES,
  slide: true, // roll from B to A without lifting
})

const pill = (id, label, input, x) => ({
  type: 'pill',
  id,
  label,
  input,
  frame: { x, y: 400, w: 96, h: 34 },
  extendedEdges: EDGES,
})

const shoulder = (id, label, input, x) => ({
  type: 'shoulder',
  id,
  label,
  input,
  frame: { x, y: 30, w: 116, h: 46 },
  extendedEdges: EDGES,
})

// The two UI buttons. Deliberately NOT `slide` and away from the thumb arc — a
// menu you open by accident mid-boss is worse than no menu.
const ui = () => [
  { type: 'ui', id: 'menu', label: '☰', action: 'pauseMenu', frame: { x: 462, y: 18, w: 40, h: 40 }, extendedEdges: EDGES },
  { type: 'ui', id: 'ff', label: '»', action: 'fastForward', frame: { x: 512, y: 18, w: 40, h: 40 }, extendedEdges: EDGES, toggle: true },
]

// Two face buttons, on the diagonal a thumb naturally rolls along (B lower-left,
// A upper-right) — Game Boy / NES / Master System / Game Gear.
const TWO_BUTTON = {
  space: SPACE,
  items: [
    dpad(),
    face('b', 'B', RETROPAD.B, 790, 300),
    face('a', 'A', RETROPAD.A, 880, 240),
    pill('select', 'SELECT', RETROPAD.SELECT, 390),
    pill('start', 'START', RETROPAD.START, 514),
    ...ui(),
  ],
}

// The SNES diamond, plus shoulders.
const FOUR_BUTTON = {
  space: SPACE,
  items: [
    dpad(),
    face('y', 'Y', RETROPAD.Y, 760, 250),
    face('b', 'B', RETROPAD.B, 838, 320),
    face('x', 'X', RETROPAD.X, 838, 180),
    face('a', 'A', RETROPAD.A, 916, 250),
    shoulder('l', 'L', RETROPAD.L, 40),
    shoulder('r', 'R', RETROPAD.R, 844),
    pill('select', 'SELECT', RETROPAD.SELECT, 390),
    pill('start', 'START', RETROPAD.START, 514),
    ...ui(),
  ],
}

// Game Boy Advance: two face buttons, but it has shoulders.
const GBA = {
  space: SPACE,
  items: [
    dpad(),
    face('b', 'B', RETROPAD.B, 790, 300),
    face('a', 'A', RETROPAD.A, 880, 240),
    shoulder('l', 'L', RETROPAD.L, 40),
    shoulder('r', 'R', RETROPAD.R, 844),
    pill('select', 'SELECT', RETROPAD.SELECT, 390),
    pill('start', 'START', RETROPAD.START, 514),
    ...ui(),
  ],
}

// Mega Drive / Genesis: a three-button row, A-B-C left to right.
//
// The RetroPad indices are genesis_plus_gx's mapping (MD A = RetroPad Y, MD B =
// RetroPad B, MD C = RetroPad A) — the one binding in this file I could not
// confirm from source, so it's worth a look in an actual Genesis game.
const SEGA_MD = {
  space: SPACE,
  items: [
    dpad(),
    face('a', 'A', RETROPAD.Y, 736, 300, 74),
    face('b', 'B', RETROPAD.B, 822, 276, 74),
    face('c', 'C', RETROPAD.A, 908, 252, 74),
    pill('start', 'START', RETROPAD.START, 452),
    ...ui(),
  ],
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

// Falls back to the two-button layout for anything unknown: a d-pad, A, B and
// Start will get you into almost any retro game, which beats no controls at all.
export function layoutFor(core) {
  return LAYOUTS[core] || TWO_BUTTON
}

export { SPACE as LAYOUT_SPACE }
