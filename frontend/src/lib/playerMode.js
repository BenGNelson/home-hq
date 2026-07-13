// The player's two state machines, both pure.
//
//  1. INPUT MODE — is the user on the on-screen touch pad, or a real controller?
//  2. PLAYER STATE — booting / awaiting the start tap / playing / paused /
//     "rotate your device" / backgrounded.

// 'touch' shows the on-screen controls; 'pad' hides them (a physical controller
// or a desktop keyboard is driving).
export function resolveInputMode({ override, padActive, hasTouch }) {
  if (override === 'touch' || override === 'pad') return override // explicit wins
  if (padActive) return 'pad'
  // No pad and no touchscreen = desktop: the keyboard drives the game, so there
  // are no on-screen controls to show either.
  return hasTouch ? 'touch' : 'pad'
}

// A pad counts as "active" from its FIRST BUTTON PRESS, never from the
// gamepadconnected event — on iOS Safari that event doesn't fire until a button
// is pressed anyway, so waiting for it would leave the touch controls up on a
// perfectly good controller.
//
// And it only goes inactive on a real disconnect, never on an idle timeout: a
// controller resting on the couch through a long cutscene must not make the
// touch pad reappear over the game.
export function nextPadActive(padActive, event) {
  if (event === 'pad-button') return true
  if (event === 'pad-disconnected') return false
  return padActive
}

// Touch mode has a real portrait layout (game on top, thumb controls below), so
// only the controller needs landscape — with no on-screen controls there's
// nothing to reflow, and a portrait letterbox wastes most of the screen.
export function shouldPromptRotate({ mode, portrait }) {
  return mode === 'pad' && !!portrait
}

export const INITIAL_PLAYER_STATE = 'BOOT'

export function nextPlayerState(state, event) {
  if (state === 'EXITING') return 'EXITING' // terminal
  if (event === 'quit') return 'EXITING'

  switch (state) {
    case 'BOOT':
      return event === 'engine-loaded' ? 'AWAIT_START' : state

    case 'AWAIT_START':
      // The engine's own Start button has been tapped. Nothing may cover the
      // player before this: on iOS the gesture that unlocks audio has to land
      // inside the player document itself.
      return event === 'started' ? 'PLAYING' : state

    case 'PLAYING':
      if (event === 'pause') return 'PAUSED'
      if (event === 'rotate-portrait') return 'ROTATE'
      if (event === 'hidden') return 'BACKGROUNDED'
      return state

    case 'PAUSED':
      if (event === 'resume') return 'PLAYING'
      if (event === 'hidden') return 'BACKGROUNDED'
      // Deliberately ignores rotate-portrait: the rotate prompt interrupts
      // active play, but it must not hijack the pause menu out from under you.
      return state

    case 'ROTATE':
      if (event === 'rotate-landscape') return 'PLAYING'
      if (event === 'pause') return 'PAUSED'
      if (event === 'hidden') return 'BACKGROUNDED'
      return state

    case 'BACKGROUNDED':
      // Never auto-resume. iOS needs a fresh gesture to restart audio, and a
      // game that un-pauses the instant you switch back is a game you're already
      // losing — you weren't holding the controller yet.
      return event === 'visible' ? 'PAUSED' : state

    default:
      return state
  }
}

// The game core only runs in PLAYING. Everything else pauses it.
export function isRunning(state) {
  return state === 'PLAYING'
}

// The engine must be left alone until the user has tapped its Start button, so
// the touch overlay can't mount before then (it would swallow that tap).
export function overlayVisible(state, mode) {
  return mode === 'touch' && (state === 'PLAYING' || state === 'PAUSED')
}
