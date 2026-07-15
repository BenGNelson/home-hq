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
//
// It takes a REAL controller, not just "mode === 'pad'": a desktop browser with
// no touchscreen also resolves to 'pad', and telling someone to rotate their
// monitor because they made the window tall is absurd.
export function shouldPromptRotate({ mode, portrait, padActive }) {
  return mode === 'pad' && !!padActive && !!portrait
}

// Can this browser actually go fullscreen?
//
// iPhone Safari has NO Fullscreen API — so the button did nothing there, which is
// exactly why it should not be shown. (It's real on desktop and on iPad, where it
// hides Safari's chrome, so it stays there.) Playing in the installed PWA is
// already chromeless, which is the iPhone's version of the same thing.
export function supportsFullscreen(doc = globalThis.document) {
  if (!doc) return false
  return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled)
}

// iOS / iPadOS, which gates audio behind a real touch: a gamepad press can't unlock
// it, so a game "started" from a pad there just gets the engine's grey "click to
// resume" screen. iPadOS 13+ reports as "MacIntel" with a touch screen, hence the
// maxTouchPoints check. Used to make A nudge the tap-cue there instead of trying (and
// failing) to boot the game with sound.
export function isIOS(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  const platform = nav.platform || ''
  return /iP(hone|od|ad)/.test(platform) || (platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1)
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

// The pre-game screens — booting, and the box-art "Start" screen — before the
// game is actually running. Once started, the machine never returns here, so this
// cleanly means "we haven't begun yet". The corner exit only shows here: it's the
// only way out before the game runs, but once PLAYING the pause menu owns Quit.
export function isPreGame(state) {
  return state === 'BOOT' || state === 'AWAIT_START'
}

// The engine must be left alone until the user has tapped its Start button, so
// the touch overlay can't mount before then (it would swallow that tap).
//
// PLAYING only — deliberately not PAUSED. Pausing releases every button in the
// core (`flushInputs`), but the overlay keeps its own record of what's held; if
// it stayed mounted across a pause, a direction still under a finger would be
// released in the core while the overlay still believed it was down, and it would
// never press it again. Unmounting throws that record away, so the two can't
// disagree.
export function overlayVisible(state, mode) {
  return mode === 'touch' && state === 'PLAYING'
}
