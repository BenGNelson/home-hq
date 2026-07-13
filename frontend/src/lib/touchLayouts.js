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
//
// The space's aspect ratio decides how much the layout gets scaled down: it's
// letterboxed to fit, so a space that's taller than the screen wastes the width.
// 1000x470 is close to a phone's landscape aspect once the safe-area insets are
// taken out, which keeps the scale near 1:1 rather than shrinking everything.
//
// Sizes below are set so that, on the narrowest phone we care about, nothing lands
// under the ~44pt minimum touch target. If you shrink one, check it against a real
// screen — the numbers are not arbitrary.
const SPACE = { w: 1000, h: 470 }

// Thumbs land low, so the bottom edge is the generous one.
//
// The rule these have to satisfy: a button's hit area may never reach into
// another button's VISIBLE frame. hitTest returns the FIRST item containing the
// point, so an intrusion doesn't split the difference — the earlier button
// silently swallows part of the later one, and you press A and get B. (Two of the
// layouts below did exactly that.) Extended edges overlapping each other in the
// dead space BETWEEN buttons is fine and even desirable; reaching a drawn button
// is not.
const EDGES = { t: 18, r: 18, b: 26, l: 18 }
const FACE_EDGES = { t: 14, r: 14, b: 20, l: 14 }
const DPAD_EDGES = { t: 24, r: 24, b: 34, l: 24 }

const dpad = () => ({
  type: 'dpad',
  id: 'dpad',
  frame: { x: 30, y: 200, w: 240, h: 240 },
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

const face = (id, label, input, x, y, size = 96) => ({
  type: 'button',
  id,
  label,
  input,
  frame: { x, y, w: size, h: size },
  extendedEdges: FACE_EDGES,
  slide: true, // roll from B to A without lifting
})

const pill = (id, label, input, x) => ({
  type: 'pill',
  id,
  label,
  input,
  frame: { x, y: 415, w: 120, h: 44 },
  extendedEdges: EDGES,
})

const shoulder = (id, label, input, x) => ({
  type: 'shoulder',
  id,
  label,
  input,
  frame: { x, y: 20, w: 150, h: 60 },
  extendedEdges: EDGES,
})

// The two UI buttons. Deliberately NOT `slide`, and kept out of the thumb arc — a
// menu you open by accident mid-boss is worse than no menu. They sit far enough
// apart that neither one's hit area can reach the other's face (see EDGES above);
// they shipped 50px apart, which was not.
const UI_EDGES = { t: 14, r: 14, b: 14, l: 14 }
const ui = () => [
  { type: 'ui', id: 'menu', label: '☰', action: 'pauseMenu', frame: { x: 400, y: 15, w: 60, h: 60 }, extendedEdges: UI_EDGES },
  { type: 'ui', id: 'ff', label: '»', action: 'fastForward', frame: { x: 540, y: 15, w: 60, h: 60 }, extendedEdges: UI_EDGES, toggle: true },
]

// Two face buttons, on the diagonal a thumb naturally rolls along (B lower-left,
// A upper-right) — Game Boy / NES / Master System / Game Gear.
const TWO_BUTTON = {
  space: SPACE,
  items: [
    dpad(),
    face('b', 'B', RETROPAD.B, 760, 320),
    face('a', 'A', RETROPAD.A, 880, 230),
    pill('select', 'SELECT', RETROPAD.SELECT, 380),
    pill('start', 'START', RETROPAD.START, 520),
    ...ui(),
  ],
}

// The SNES diamond, plus shoulders.
const FOUR_BUTTON = {
  space: SPACE,
  items: [
    dpad(),
    face('y', 'Y', RETROPAD.Y, 700, 233, 84),
    face('b', 'B', RETROPAD.B, 808, 341, 84),
    face('x', 'X', RETROPAD.X, 808, 125, 84),
    face('a', 'A', RETROPAD.A, 914, 233, 84),
    shoulder('l', 'L', RETROPAD.L, 30),
    shoulder('r', 'R', RETROPAD.R, 820),
    pill('select', 'SELECT', RETROPAD.SELECT, 380),
    pill('start', 'START', RETROPAD.START, 520),
    ...ui(),
  ],
}

// Game Boy Advance: two face buttons, but it has shoulders.
const GBA = {
  space: SPACE,
  items: [
    dpad(),
    face('b', 'B', RETROPAD.B, 760, 320),
    face('a', 'A', RETROPAD.A, 880, 230),
    shoulder('l', 'L', RETROPAD.L, 30),
    shoulder('r', 'R', RETROPAD.R, 820),
    pill('select', 'SELECT', RETROPAD.SELECT, 380),
    pill('start', 'START', RETROPAD.START, 520),
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
    face('a', 'A', RETROPAD.Y, 690, 330, 88),
    face('b', 'B', RETROPAD.B, 800, 290, 88),
    face('c', 'C', RETROPAD.A, 910, 250, 88),
    pill('start', 'START', RETROPAD.START, 450),
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
