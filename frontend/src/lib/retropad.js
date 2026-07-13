// RetroPad — the abstract controller EmulatorJS speaks.
//
// Every libretro core maps these indices onto its own hardware, which is why one
// control preset covers all six systems: a Game Boy's A and a SNES's A are both
// index 8, and a core simply ignores the buttons it has no hardware for.
//
// Its own module because both emuBridge (which sends inputs) and controlPresets
// (which maps a physical pad onto them) need it — importing it from either one
// would make them import each other, and the preset builds its lookup table at
// module-evaluation time, so a half-initialized circular import would blow up.
export const RETROPAD = {
  B: 0,
  Y: 1,
  SELECT: 2,
  START: 3,
  UP: 4,
  DOWN: 5,
  LEFT: 6,
  RIGHT: 7,
  A: 8,
  X: 9,
  L: 10,
  R: 11,
  L2: 12,
  R2: 13,
  L3: 14,
  R3: 15,
}

// 0-15 are the digital buttons above. 16+ are analog axes and the engine's own
// hotkeys (quick-save, fast-forward, rewind) — we never drive those from the app,
// so a "release everything" flush only has to cover the digital range.
export const DIGITAL_INPUTS = 16
