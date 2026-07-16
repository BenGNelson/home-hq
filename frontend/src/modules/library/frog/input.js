// How Frog reads its controls — touch (fingers) or pad (a gamepad, or a desktop
// keyboard/mouse, which drive the same grid-and-focus model).
//
// Frog was born controller-first, but it's also the Library's games screen, and on
// a phone there's no controller — so the same browser has to be first-class by
// touch. Rather than fork into two apps, it tracks ONE mode and lets each screen
// adapt the couple of places where a finger and a D-pad genuinely want different
// things (chiefly: the search keyboard).

// The mode Frog opens in, before any input has happened. A coarse pointer — a
// phone or tablet touchscreen — means fingers, so start in touch; a fine pointer —
// a desktop mouse — means the keyboard/pad model. Either way the first real input
// flips it (see below), so this is only the opening guess.
export function defaultFrogMode(coarsePointer) {
  return coarsePointer ? 'touch' : 'pad'
}

// The next mode after an input event. A gamepad button → 'pad'; a finger → 'touch'.
// This is what lets an iPad with a controller start in 'touch' (coarse pointer) and
// become 'pad' the instant Ben presses a button — then flip back the moment he taps
// the glass.
//
// Kin to the player's `padActive` (lib/playerMode.js) but DELIBERATELY not identical:
// the player only reverts to touch on a pad *disconnect* (a controller resting through
// a cutscene mustn't make the on-screen pad reappear mid-game), whereas a browser has
// no such worry — here a single finger tap is the clearest possible "I'm on touch now",
// so we honour it immediately. Don't "unify" the two by copying one comment's promise
// onto the other.
export function nextFrogMode(current, event) {
  if (event === 'pad') return 'pad'
  if (event === 'touch') return 'touch'
  return current
}

// The search screen is the one place a finger and a D-pad want different keyboards.
// Touch gets the device's own keyboard — familiar, fast, and it doesn't fight the
// muscle memory of every other text field on the phone. Pad/desktop keeps the 6×6
// dead-key grid, which is built to be walked with a D-pad and to dim the doors that
// lead nowhere before you press them.
export function usesNativeKeyboard(mode) {
  return mode === 'touch'
}
