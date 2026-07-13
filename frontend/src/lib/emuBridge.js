// The only module in the app allowed to reach into the player iframe.
//
// The emulator runs in its own document (public/emulator.html) so its window
// globals, WASM heap and AudioContext never touch the SPA, and unmounting the
// route tears the whole engine down (EmulatorJS has no destroy()). But the
// iframe is SAME-ORIGIN, so the parent can hold the live engine instance
// directly — a plain synchronous call, no postMessage, no serialization, no
// added frame of input latency. Everything else in the app goes through here.
//
// The player document exposes `window.HQ` (see emulator.html); the parent hands
// its engine config the other way via `window.HQ_PLAYER_CONFIG`, which the
// player reads off window.parent at boot.

import { presetFor, EJS_BUTTONS_OFF, EJS_HIDE_SETTINGS } from './controlPresets.js'
import { RETROPAD, DIGITAL_INPUTS } from './retropad.js'

// Re-exported so callers can reach the engine and its button indices from one
// place; retropad.js exists only to keep this module and controlPresets from
// importing each other.
export { RETROPAD, DIGITAL_INPUTS }

// The version of the window.HQ contract this bundle speaks. emulator.html
// stamps the same number on the handle it exposes; a mismatch means the player
// document and the app bundle are out of step (a stale cached emulator.html), and
// we fall back to the engine's own UI rather than half-wiring ours.
export const HQ_CONTRACT_VERSION = 1

// The engine config the parent hands the player document. It lives HERE rather
// than hardcoded in emulator.html on purpose: emulator.html is excluded from
// the PWA precache and versioned by hand (ENGINE_VERSION in offlineStore.js),
// so every edit to it forces a re-download on every device. Config that lives
// in the app bundle rides the content-hashed shell instead — which means the
// control presets, hidden buttons and menu settings can all change later
// without touching the player document again.
export function playerConfig(core) {
  return {
    // Save states go to the browser (IndexedDB), not a downloaded .state file
    // (which iOS can't open). Our own EJS_onSaveState hook does the real work.
    defaultOptions: { 'save-state-location': 'browser' },

    // A physical pad works out of the box, mapped by position (see controlPresets).
    defaultControls: presetFor(core),

    // The engine's own bottom bar and settings screen, replaced by the HQ pause menu.
    buttons: EJS_BUTTONS_OFF,
    hideSettings: EJS_HIDE_SETTINGS,

    // Switch OFF the engine's localStorage entirely.
    //
    // It persists the control map per-game and reloads it on every boot — so the
    // FIRST time a game was played would freeze whatever mapping was in effect
    // then, and our preset would be silently overwritten from that point on. It
    // also means a preset fix would never reach a game you'd already played.
    // Turning the whole thing off makes the preset permanently authoritative and
    // costs us only the engine's volume/shader prefs, which lib/playerSettings.js
    // now owns anyway.
    disableLocalStorage: true,
  }
}

// The player document's handle, or null if the iframe is gone / not booted yet.
// Guarded: reading contentWindow throws if the frame is ever cross-origin, and
// returns null mid-teardown.
export function readHandle(frame) {
  try {
    return (frame && frame.contentWindow && frame.contentWindow.HQ) || null
  } catch {
    return null
  }
}

// A handle we can actually drive. `whenStarted` must be a real promise — if it's
// missing, `Promise.resolve(undefined)` would settle on the next microtask and we
// would declare the game "started" before the user has tapped anything, drop the
// overlay over the engine's Start button, and (on iOS) never unlock audio. So a
// malformed or unknown-version handle is treated as no handle at all: the player
// falls back to the engine's own UI, which still works.
//
// This is the case when a device is running a NEW app bundle against an OLD
// cached emulator.html — the service worker serves the player document from the
// offline cache, and that copy refreshes on its own schedule.
export function isSupportedHandle(hq) {
  return !!hq && hq.version === HQ_CONTRACT_VERSION && typeof hq.whenStarted?.then === 'function'
}

// The live EmulatorJS instance, or null before the engine has loaded.
export const readEmu = (frame) => readHandle(frame)?.emu ?? null

// Resolves with the engine instance once the game has actually STARTED — i.e.
// after the user has tapped the engine's own Start button. That tap has to land
// inside the iframe (iOS unlocks audio per-document), so nothing in the parent
// may cover the player before this resolves.
//
// ALWAYS settles, and resolves null rather than throwing. That matters: the game
// may never start at all (the user backs out before tapping Start; loader.js
// 404s and the player shows "engine not installed"), and a promise that hangs
// forever in those cases would leave the caller waiting on a spinner with no
// engine, no error and no way forward. Pass an AbortSignal to settle it early
// when the route unmounts.
export async function attachEmu(frame, { signal } = {}) {
  const aborted = () => !!signal?.aborted
  if (aborted()) return null

  const hq = await whenHandle(frame, signal)
  if (!isSupportedHandle(hq) || aborted()) return null

  const started = hq.whenStarted.then(
    () => true,
    () => false
  )
  const ok = await Promise.race([started, abortPromise(signal).then(() => false)])
  if (!ok || aborted()) return null
  return readEmu(frame)
}

// The handle appears when the iframe's document runs its inline script, which is
// AFTER the frame is created and its src set. Callers shouldn't have to know that
// — waiting on the frame's own load event is this module's job, not theirs.
function whenHandle(frame, signal) {
  const now = readHandle(frame)
  if (now || !frame?.addEventListener) return Promise.resolve(now)

  return new Promise((resolve) => {
    const done = () => {
      frame.removeEventListener('load', onLoad)
      resolve(readHandle(frame))
    }
    const onLoad = () => done()
    frame.addEventListener('load', onLoad, { once: true })
    signal?.addEventListener('abort', done, { once: true })
  })
}

function abortPromise(signal) {
  if (!signal) return new Promise(() => {}) // never settles; only ever raced against
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
}

// --- audio -----------------------------------------------------------------

// iOS suspends a page's AudioContext at the drop of a hat — backgrounding, a
// phone call, the Control Centre — and only a USER GESTURE IN THAT DOCUMENT can
// start it again.
//
// That used to happen by itself: the engine's touch controls lived inside the
// player document, so every button press was a gesture in there. Now the controls
// are ours, in the parent, and they preventDefault everything — so after the one
// tap on the engine's Start button, the player document never sees another gesture
// for as long as you play. Once its audio is suspended, nothing wakes it, and the
// game goes silent for good.
//
// So the parent has to do it: catch every AudioContext the player document makes,
// and resume them whenever the user touches anything. Same-origin, so we can.
const AUDIO_CONTEXTS = '__hqAudioContexts'
const PATCHED = '__hqAudioPatched'

export function trackAudio(frame) {
  let win
  try {
    win = frame && frame.contentWindow
  } catch {
    return false
  }
  if (!win || win[PATCHED]) return false

  const contexts = []
  for (const key of ['AudioContext', 'webkitAudioContext']) {
    const Original = win[key]
    if (typeof Original !== 'function') continue
    function Tracked(...args) {
      const ctx = new Original(...args)
      contexts.push(ctx)
      // Resume it the instant it's born. The core builds its audio
      // ASYNCHRONOUSLY, well after the tap on Start — so on iOS it arrives
      // already suspended, and the game is silent from the first frame. The
      // player document still has activation from that tap, which is what makes
      // this resume legal.
      try {
        ctx.resume?.()
      } catch {
        // Falls back to the resume-on-next-touch handler in PlayerShell.
      }
      return ctx
    }
    Tracked.prototype = Original.prototype
    win[key] = Tracked
  }
  win[PATCHED] = true
  win[AUDIO_CONTEXTS] = contexts
  return true
}

// Wake the game's audio back up. Cheap and idempotent — safe to call on every
// touch. MUST be called synchronously from a real user-gesture handler, or iOS
// ignores it.
export function resumeAudio(frame) {
  let contexts
  try {
    contexts = frame?.contentWindow?.[AUDIO_CONTEXTS]
  } catch {
    return
  }
  for (const ctx of contexts || []) {
    try {
      if (ctx.state === 'suspended') ctx.resume()
    } catch {
      // Nothing to do. A silent game is bad; a crashed one is worse.
    }
  }
}

// --- engine chrome ---------------------------------------------------------

// The engine's own UI, which the HQ overlay replaces.
const CHROME_STYLE_ID = 'hq-kill-chrome'
const CHROME_CSS = {
  // The bottom control bar (save/load/settings/fullscreen icons) and the
  // hamburger that opens it. Replaced by the HQ pause menu.
  menuBar: '.ejs_menu_bar, .ejs_menu_bar_hidden, .ejs_virtualGamepad_open { display: none !important; }',
  // The right-click/long-press context menu (screenshot, quick save/load).
  contextMenu: '.ejs_context_menu { display: none !important; }',
  // The built-in touch pad. `!important` is NOT belt-and-braces here: the engine
  // re-shows it from two places we can't intercept — startGame() force-shows it
  // whenever Start was tapped with a finger, and handleResize() un-hides it for
  // 250ms on EVERY resize, which includes every device rotation. JS alone loses
  // that race; CSS doesn't.
  virtualGamepad: '.ejs_virtualGamepad_parent { display: none !important; }',
}

// Suppress parts of the engine's own UI by injecting a stylesheet into the
// player document. Done from here rather than in emulator.html so the app can
// change what it hides without bumping ENGINE_VERSION (which would re-download
// the ~300MB engine on every device). Idempotent — safe to call on every render.
export function killEngineChrome(frame, parts = {}) {
  let doc
  try {
    doc = frame && frame.contentDocument
  } catch {
    return false
  }
  if (!doc || !doc.head) return false

  const css = Object.keys(CHROME_CSS)
    .filter((part) => parts[part])
    .map((part) => CHROME_CSS[part])
    .join('\n')

  let style = doc.getElementById(CHROME_STYLE_ID)
  if (!style) {
    style = doc.createElement('style')
    style.id = CHROME_STYLE_ID
    doc.head.appendChild(style)
  }
  style.textContent = css
  return true
}

// --- driving the engine ----------------------------------------------------

// Hold or release a single RetroPad button. This is how BOTH the on-screen touch
// pad and our synthetic presses reach the game.
export function press(emu, index, down, player = 0) {
  try {
    emu.gameManager.simulateInput(player, index, down ? 1 : 0)
    return true
  } catch {
    return false
  }
}

// A momentary button press — used for the synthetic START we send when the
// controller's Menu button is short-pressed (long-press opens our pause menu
// instead, so START isn't bound on the pad at all).
export function tap(emu, index, { player = 0, ms = 50, schedule = setTimeout } = {}) {
  if (!press(emu, index, true, player)) return false
  schedule(() => press(emu, index, false, player), ms)
  return true
}

// Release every digital button. Called on every resume: a button held when the
// pause menu opened would otherwise stay latched in the core forever, and the
// game would come back walking into a wall.
export function flushInputs(emu, player = 0) {
  for (let i = 0; i < DIGITAL_INPUTS; i++) press(emu, i, false, player)
}

// Stop the engine's own gamepad handler from feeding the game while our menus
// are open — otherwise the D-pad presses that navigate the pause menu also drive
// the (paused) game underneath.
//
// WRAPS the engine's listeners rather than replacing them: its GamepadHandler
// stores exactly ONE callback per event name, so a naive `.on()` would silently
// clobber the engine's own input handling and the pad would stop working
// entirely. Returns a restore function.
// Where we stash the engine's TRUE handlers, on the engine's own gamepad object.
//
// Gating has to be safe to do twice (a re-render, a StrictMode double-effect,
// reopening the menu before a previous restore ran). The naive version captures
// `gp.listeners` fresh on every call — so a second gate captures the FIRST gate's
// wrapper as if it were the engine's handler, and restoring then reinstalls a gate
// belonging to a menu that no longer exists. The controller goes dead for the rest
// of the session, with no way back short of relaunching the game.
//
// So capture the originals exactly once and always delegate to those.
const ORIGINALS = '__hqOriginalGamepadListeners'

export function gateEngineGamepad(emu, isGated) {
  let gp
  try {
    gp = emu.gamepad
  } catch {
    return () => {}
  }
  if (!gp || !gp.listeners || typeof gp.on !== 'function') return () => {}

  if (!gp[ORIGINALS]) gp[ORIGINALS] = { ...gp.listeners }
  const original = gp[ORIGINALS]

  for (const name of Object.keys(original)) {
    if (typeof original[name] !== 'function') continue
    // Re-install on every call so the wrapper closes over the CURRENT isGated,
    // but always delegating to the engine's real handler — never to a wrapper.
    gp.on(name, (e) => {
      if (!isGated()) original[name](e)
    })
  }

  return () => {
    for (const name of Object.keys(original)) gp.on(name, original[name])
    delete gp[ORIGINALS]
  }
}

export function setPaused(emu, paused) {
  try {
    if (paused) emu.pause()
    else emu.play()
    return true
  } catch {
    return false
  }
}

export function restart(emu) {
  try {
    emu.gameManager.restart()
    return true
  } catch {
    return false
  }
}

export function setFastForward(emu, on) {
  try {
    // Reuse the engine's own setting rather than gameManager.toggleFastForward()
    // so the ratio configured in its settings is respected and `emu.isFastForward`
    // stays truthful.
    emu.changeSettingOption('fastForward', on ? 'enabled' : 'disabled')
    return true
  } catch {
    return false
  }
}
