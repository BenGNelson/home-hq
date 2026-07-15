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

import { buildControls, EJS_BUTTONS_OFF, EJS_HIDE_SETTINGS } from './controlPresets.js'
import { sectionAccent } from './library.js'
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
export function playerConfig(core, controls, { name, coverUrl } = {}) {
  return {
    // --- the start screen ---
    // It belongs to the engine, and it has to: that Start tap is the gesture that
    // unlocks audio on iOS, so it must land inside the player document. But how it
    // LOOKS is ours — see styleStartScreen at the bottom of this file. The engine
    // ships a grey box with the button stuck to the bottom edge.
    alignStartButton: 'center',
    startButtonName: 'Play',
    ...(coverUrl ? { backgroundImage: coverUrl, backgroundBlur: true } : {}),
    backgroundColor: '#020617', // slate-950, so it matches the rest of the app
    // Save states go to the browser (IndexedDB), not a downloaded .state file
    // (which iOS can't open). Our own EJS_onSaveState hook does the real work.
    defaultOptions: { 'save-state-location': 'browser' },

    // A physical pad works out of the box (see controlPresets).
    defaultControls: buildControls(controls),

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

// --- screenshots -----------------------------------------------------------

// Make the game's canvas readable, so a save state can have a picture on it.
//
// A WebGL canvas throws its drawing buffer away the moment the frame is composited,
// unless it was created with `preserveDrawingBuffer`. The engine never sets it — so
// reading the canvas back afterwards yields a perfectly valid, perfectly BLACK
// image. That is why every save-state thumbnail was a black rectangle.
//
// The engine's other screenshot source ("retroarch", which asks the core for the
// frame) is not an option: on these cores it kills the player document outright —
// the Emscripten module aborts and takes the whole iframe with it.
//
// So we patch getContext in the player document BEFORE the engine creates its
// context, and force the flag on. Costs a little GPU bandwidth (the buffer has to be
// kept around); buys a screenshot that isn't a lie.
export function preserveCanvas(frame) {
  let win
  try {
    win = frame && frame.contentWindow
  } catch {
    return false
  }
  const proto = win?.HTMLCanvasElement?.prototype
  if (!proto || proto.__hqPreserved) return false

  const original = proto.getContext
  proto.getContext = function (type, attrs) {
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
      return original.call(this, type, { ...(attrs || {}), preserveDrawingBuffer: true })
    }
    return original.call(this, type, attrs)
  }
  proto.__hqPreserved = true
  return true
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

// Re-map the controller on a RUNNING game. The engine reads `emu.controls` on every
// button event, so a remap takes effect on the very next press — no reload, and you
// can feel the change while you're still holding the pad.
export function applyControls(emu, controls) {
  try {
    emu.controls = buildControls(controls)
    return true
  } catch {
    return false
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

// --- the start screen ------------------------------------------------------

// The engine draws the screen you see before a game boots, and it has to: the tap on
// its Start button is the gesture that unlocks audio on iOS, so it must land inside
// the player document. But it ships as a grey box with the button pinned to the
// bottom edge and the loading state as one line of bare text.
//
// So we style it from out here, the same way killEngineChrome does — CSS injected
// into the player document, which keeps it in the app bundle where changing it is
// free. The button is MOVED into our layout, never recreated, so it keeps the
// engine's own listener and the audio unlock still works.
const START_STYLE_ID = 'hq-start-screen'

// `onStart` fires when the Play button is tapped — the parent shows the frog then.
// The frog deliberately does NOT live in this document: the engine resizes the iframe
// when the game starts (the touch controls take half the screen), and anything centred
// inside a box that changes size moves when it changes size.
export function styleStartScreen(frame, { coverUrl, name, onStart, accent, ground } = {}) {
  let doc
  try {
    doc = frame && frame.contentDocument
  } catch {
    return false
  }
  if (!doc?.head || doc.getElementById(START_STYLE_ID)) return false

  // Frog's water identity by default (green-black pond, jade glow); falls back to the
  // Games violet if no palette is passed. PlayerShell hands in FROG's colours — the
  // player is Frog's screen now, so the launch flow (shelf → start → loading frog →
  // game) should read as one continuous world, not a violet screen that turns green.
  const rgb = accent || sectionAccent('games').rgb
  // A hex, deliberately: the pond gradient appends an alpha (`${bg}00`), which only
  // parses on a hex colour. PlayerShell passes FROG.ground (a hex); this is the fallback.
  const bg = ground || '#020617'
  const style = doc.createElement('style')
  style.id = START_STYLE_ID
  style.textContent = `
    /* The game's own cover art, pushed right back so it reads as atmosphere. */
    .ejs_game_background {
      filter: blur(38px) saturate(1.5) brightness(0.5) !important;
      transform: scale(1.25);
      opacity: 0.5;
    }
    /* The pond: Frog's green-black ground with a jade glow welling up from below,
       instead of the app-wide violet radiance. */
    .ejs_parent::after {
      content: '';
      position: absolute; inset: 0; pointer-events: none;
      background:
        radial-gradient(120% 85% at 50% 62%, rgba(${rgb},0.22), transparent 60%),
        linear-gradient(to bottom, ${bg}00, ${bg}), ${bg};
    }

    /* Our column: the box art (with its reflection), the title, the button, the cue. */
    .hq-start {
      position: absolute; left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      z-index: 3;
      display: flex; flex-direction: column; align-items: center; gap: 16px;
      width: max-content; max-width: 86vw;
      animation: hq-rise 560ms cubic-bezier(.2,.8,.2,1) both;
    }
    .hq-start-art {
      width: 132px; aspect-ratio: 3/4;
      border-radius: 12px; object-fit: cover;
      box-shadow:
        0 0 0 1px rgba(255,255,255,0.12),
        0 24px 60px -12px rgba(0,0,0,0.85),
        0 0 80px -10px rgba(${rgb},0.55);
      animation: hq-float 5s ease-in-out infinite;
    }
    /* Frog's signature: the thing floating on the pond throws a soft reflection down
       into it. A mirrored, fading copy of the art, tucked right under it. */
    .hq-start-reflect {
      width: 132px; aspect-ratio: 3/4;
      border-radius: 12px; object-fit: cover;
      margin-top: -30px; /* pull it up under the art, past the column gap */
      transform: scaleY(-1);
      opacity: 0.16;
      filter: blur(1px);
      -webkit-mask-image: linear-gradient(to bottom, #000, transparent 62%);
      mask-image: linear-gradient(to bottom, #000, transparent 62%);
      pointer-events: none;
      animation: hq-float 5s ease-in-out infinite;
    }
    .hq-start-title {
      margin: 0; max-width: 22ch; text-align: center;
      color: #E6F5EE; /* FROG.ink */
      font: 600 18px/1.3 system-ui, -apple-system, sans-serif;
      text-shadow: 0 2px 20px rgba(0,0,0,0.7);
    }
    /* The cue: how to start it, in Frog's jade — and it names the A button, so a
       controller player learns they don't have to reach for the glass. */
    .hq-start-cue {
      margin: 2px 0 0; letter-spacing: 0.24em;
      color: rgb(${rgb});
      font: 600 11px/1 system-ui, -apple-system, sans-serif;
      animation: hq-pulse 1.9s ease-in-out infinite;
    }
    /* A quick emphasis when a controller player presses A on iOS — where a pad can't
       start the game with audio, so we bounce the cue to say "tap instead". */
    .hq-start-cue.hq-cue-flash { animation: hq-cueflash 0.5s ease; }
    @keyframes hq-cueflash {
      0%,100% { transform: scale(1); color: rgb(${rgb}); }
      40% { transform: scale(1.3); color: #fff; }
    }

    /* The WHOLE screen starts the game. On iOS a game can only begin WITH SOUND from a
       real touch, so the target is the entire screen, not just the button — one tap
       anywhere, no hunting for a pill, no "click to resume". It sits above everything;
       clicking the engine's button from a real tap keeps the user-activation that
       unlocks audio. */
    .hq-start-tap {
      position: fixed; inset: 0; z-index: 4; cursor: pointer;
    }

    /* Tapping Play sends the card away IMMEDIATELY. The engine removes only its own
       Start button; it knows nothing about the column we wrapped it in, so without
       this the art stayed bobbing in the middle of the running game. */
    .hq-start-out {
      pointer-events: none;
      animation: hq-fall 260ms cubic-bezier(.4,0,1,1) forwards !important;
    }
    .hq-start-out .hq-start-art, .hq-start-out .hq-start-reflect { animation: none !important; }
    @keyframes hq-fall {
      to { opacity: 0; transform: translate(-50%, calc(-50% + 10px)) scale(0.96); }
    }

    /* NB: the engine puts .ejs_start_button AND .ejs_start_button_border on the SAME
       element. Style "the border" and you're styling the button. */
    .ejs_start_button {
      position: static !important;
      margin: 0 !important;
      padding: 13px 46px !important;
      border: 0 !important;
      border-radius: 9999px !important;
      background: rgba(${rgb}, 0.95) !important;
      color: #04110D !important; /* dark ink on jade, so it reads as Frog, not a link */
      font: 700 16px/1 system-ui, -apple-system, sans-serif !important;
      text-transform: none !important;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.18), 0 12px 44px -8px rgba(${rgb},0.9);
      transition: transform 120ms ease;
      cursor: pointer;
      /* The engine centres this button with its own translate. Inside our flex column
         that just shoves it off to one side, so the transform has to go. */
      transform: none !important;
    }
    .ejs_start_button:active { transform: scale(0.96) !important; }

    /* Loading: a breathing ring, not a line of bare text. */
    .ejs_loading_text {
      position: absolute; left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      z-index: 3;
      color: #93B5A8 !important; /* FROG.soft */
      font: 500 13px/1.4 system-ui, -apple-system, sans-serif !important;
      text-shadow: none !important;
      letter-spacing: 0.04em;
      padding-top: 60px; text-align: center;
    }
    .ejs_loading_text::before {
      content: '';
      position: absolute; top: 0; left: 50%; margin-left: -21px;
      width: 42px; height: 42px;
      border-radius: 9999px;
      border: 2px solid rgba(${rgb}, 0.22);
      border-top-color: rgba(${rgb}, 1);
      animation: hq-spin 720ms linear infinite;
    }
    .ejs_loading_text_glow { display: none !important; }

    @keyframes hq-spin { to { transform: rotate(360deg); } }
    @keyframes hq-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-7px) } }
    @keyframes hq-pulse { 0%,100% { opacity: 0.45 } 50% { opacity: 1 } }
    @keyframes hq-rise {
      from { opacity: 0; transform: translate(-50%, calc(-50% + 12px)) scale(0.97); }
      to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }
  `
  doc.head.appendChild(style)

  // The engine only builds its Start button once the core has loaded, so it isn't
  // there yet. Wait for it, then wrap it in our column. Moving it preserves the
  // engine's click listener — which is the whole ballgame on iOS.
  const decorate = () => {
    const button = doc.querySelector('.ejs_start_button')
    if (!button || button.parentElement?.classList.contains('hq-start')) return false

    const column = doc.createElement('div')
    column.className = 'hq-start'

    if (coverUrl) {
      const art = doc.createElement('img')
      art.className = 'hq-start-art'
      art.src = coverUrl
      art.alt = ''
      column.appendChild(art)

      // Frog's water reflection: a mirrored, fading copy of the art on the pond below.
      const reflect = doc.createElement('img')
      reflect.className = 'hq-start-reflect'
      reflect.src = coverUrl
      reflect.setAttribute('aria-hidden', 'true')
      column.appendChild(reflect)

      // No box art for this one — drop both the art and its reflection, don't fake it.
      art.onerror = () => {
        art.remove()
        reflect.remove()
      }
    }
    if (name) {
      const title = doc.createElement('p')
      title.className = 'hq-start-title'
      title.textContent = name
      column.appendChild(title)
    }

    const host = button.parentElement // the engine's full-screen container
    host.insertBefore(column, button)
    column.appendChild(button)

    // How to start it, in Frog's jade. "TAP TO PLAY" because a tap is the one thing
    // that works everywhere — on iOS a pad literally can't start a game with sound, so
    // promising "PRESS A" there was a lie. Pressing A on iOS bounces this cue instead
    // (flashStartCue), which reads as "no — tap".
    const cue = doc.createElement('p')
    cue.className = 'hq-start-cue'
    cue.textContent = 'TAP TO PLAY'
    column.appendChild(cue)

    // The whole-screen tap target. A real tap on it clicks the engine's Start button
    // from inside a user gesture, so audio unlocks — one tap ANYWHERE starts the game
    // with sound, instead of only the small pill (and no "click to resume" white screen
    // from a tap that missed).
    const tap = doc.createElement('div')
    tap.className = 'hq-start-tap'
    tap.addEventListener('click', () => button.click(), { once: true })
    host.appendChild(tap)

    // The tap that starts the game hands the screen over: the card falls away and the
    // frog takes its place. This listener only ever swaps some DOM — the engine's own
    // listener (the one that unlocks audio on iOS) is untouched, which is the whole
    // reason the button is MOVED into our column rather than recreated inside it.
    button.addEventListener('click', () => {
      column.classList.add('hq-start-out')
      tap.remove() // stop it eating taps meant for the running game
      onStart?.()
    }, { once: true })
    return true
  }

  if (!decorate()) {
    const Observer = frame.contentWindow?.MutationObserver
    if (!Observer) return true
    const observer = new Observer(() => {
      if (decorate()) observer.disconnect()
    })
    observer.observe(doc.body, { childList: true, subtree: true })
    setTimeout(() => observer.disconnect(), 120_000) // don't watch forever
  }
  return true
}

// Start the game from a controller.
//
// The Start button lives inside the player document on purpose — its tap is what
// unlocks iOS audio — so a pad, which has no tap, can't reach it the normal way. We
// click it programmatically instead: that fires BOTH the engine's own start listener
// (boot the core) and ours (raise the frog), exactly like a real tap.
//
// The one thing a synthetic click can't do is carry iOS user-activation, so on iPhone/
// iPad the game starts but its AudioContext may stay suspended until a real touch. The
// caller handles that (see PlayerShell's "tap for sound" fallback). On desktop and
// Android it just works.
export function pressStart(frame) {
  let doc
  try {
    doc = frame && frame.contentDocument
  } catch {
    return false
  }
  const button = doc?.querySelector('.ejs_start_button')
  if (!button) return false
  button.click()
  return true
}

// Take the start screen out of the DOM once the game is actually running.
//
// Fading the card is not enough. A faded element is still an element: it keeps its
// float animation on the compositor, and the engine's blurred cover-art backdrop sits
// over the canvas for the whole session. Nothing else was ever going to clean this up
// — the engine removes ITS button and has no idea our layer exists.
//
// Everything here is idempotent and guarded: the frame can be torn down mid-flight.
export function clearStartScreen(frame) {
  let doc
  try {
    doc = frame && frame.contentDocument
  } catch {
    return false
  }
  if (!doc) return false

  doc.querySelector('.hq-start')?.remove()
  doc.querySelector('.hq-start-tap')?.remove() // the whole-screen tap target
  // The engine's own backdrop. It's the game's cover art, blurred — atmosphere before
  // the game, a smear over the top of it after.
  doc.querySelector('.ejs_game_background')?.remove()

  doc.getElementById(START_STYLE_ID)?.remove()
  return true
}

// Bounce the "PRESS A OR TAP" cue. Used when a controller player presses A on iOS,
// where a pad can't start the game with audio — the flash says "tap instead" without
// dumping them into the engine's grey "click to resume" screen.
export function flashStartCue(frame) {
  let doc
  try {
    doc = frame && frame.contentDocument
  } catch {
    return
  }
  const cue = doc?.querySelector('.hq-start-cue')
  if (!cue) return
  cue.classList.remove('hq-cue-flash')
  void cue.offsetWidth // restart the animation if it's mid-flight
  cue.classList.add('hq-cue-flash')
}
