import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Menu, Maximize, Minimize } from 'lucide-react'
import { playerSrc, coverUrl } from '../../../lib/library.js'
import { useOnline } from '../../../lib/online.jsx'
import { goBack } from '../../../lib/nav.js'
// The player is Frog's screen. It's launched from Home HQ's Games pages too, but the
// thing you're doing is playing a game — and when Frog moves to its own repo, the
// player goes with it. So it dresses in Frog's clothes, wherever you came in from.
import { FROG, systemStyle, systemForCore } from '../frog/theme.js'
import { frogLoaderSvg, frogLoaderCss, nextFill, phaseLabel } from '../frog/loader.js'
import {
  RETROPAD,
  playerConfig,
  attachEmu,
  killEngineChrome,
  clearStartScreen,
  applyControls,
  styleStartScreen,
  preserveCanvas,
  trackAudio,
  resumeAudio,
  press,
  tap,
  flushInputs,
  gateEngineGamepad,
  setPaused,
  setFastForward,
  restart as restartGame,
} from '../../../lib/emuBridge.js'
import {
  nextPlayerState,
  INITIAL_PLAYER_STATE,
  isRunning,
  resolveInputMode,
  shouldPromptRotate,
  overlayVisible,
  supportsFullscreen,
} from '../../../lib/playerMode.js'
import {
  readSettings,
  writeSettings,
  migrateLegacyEjsKeys,
  bindingsFor,
  withBinding,
  clearBindings,
} from '../../../lib/playerSettings.js'
import { bindingForButton } from '../../../lib/gamepad.js'
import { useGamepad } from '../../../lib/useGamepad.js'
import { useWakeLock } from '../../../lib/useWakeLock.js'
import { useGameSaves } from '../../../lib/useGameSaves.js'
import { useMediaQuery } from '../../../lib/useMediaQuery.js'
import { moveInGrid } from '../../../lib/gridNav.js'
import { saveState, loadState, listStates, deleteState } from '../../../lib/saveStates.js'
import PauseMenu, { pauseItems, pauseCols } from './PauseMenu.jsx'
import SaveStatePanel from './SaveStatePanel.jsx'
import ControlsPanel, { controlRows } from './ControlsPanel.jsx'
import ButtonLegend from './ButtonLegend.jsx'
import RotatePrompt from './RotatePrompt.jsx'
import TouchOverlay from './TouchOverlay.jsx'
import { PORTRAIT_GAME_HEIGHT } from '../../../lib/touchLayouts.js'

// The game player. Hosts the emulator iframe and everything layered over it.
//
// The engine itself stays inside emulator.html (its own document) so its window
// globals, WASM heap and audio context never touch the app, and unmounting this
// route tears the whole thing down — EmulatorJS has no destroy(). But the iframe
// is same-origin, so we hold the live engine instance directly and drive it with
// plain method calls (see lib/emuBridge.js). No postMessage, no added latency.
//
// The one rule that everything else bends around: the tap that starts the game
// has to land INSIDE the iframe, because iOS unlocks audio per-document. So we
// show the engine's own Start button and put nothing over it until the game is
// actually running.
export default function PlayerShell({ id, core, name, label, loadStateUrl }) {
  const navigate = useNavigate()
  const { online } = useOnline()

  const wrapperRef = useRef(null)
  const frameRef = useRef(null)
  const emuRef = useRef(null)

  const [state, dispatch] = useReducer(nextPlayerState, INITIAL_PLAYER_STATE)
  const [menuFocus, setMenuFocus] = useState(0)
  const [fastForward, setFF] = useState(false)
  const [immersive, setImmersive] = useState(false)

  // The save-state shelf, layered over the pause menu.
  const [shelfOpen, setShelfOpen] = useState(false)
  const [states, setStates] = useState([])
  const [statesLoading, setStatesLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Is a physical controller driving? Becomes true on the FIRST BUTTON PRESS —
  // never on `gamepadconnected`, which iOS Safari doesn't fire until a button is
  // pressed anyway, so waiting for it would leave the touch controls sitting over
  // a perfectly good pad.
  const [padActive, setPadActive] = useState(false)
  const [padHint, setPadHint] = useState(false) // the "hold ☰ for the menu" nudge
  const [padId, setPadId] = useState(null)
  const [padName, setPadName] = useState(null)
  const [settings, setSettings] = useState(() => {
    // The engine's localStorage is off now (it would overwrite our control
    // preset), so its old per-game blobs are dead bytes. Sweep them once.
    migrateLegacyEjsKeys(window.localStorage)
    return readSettings(window.localStorage)
  })

  // The Controls screen.
  const [controlsOpen, setControlsOpen] = useState(false)
  const [controlsFocus, setControlsFocus] = useState(0)
  const [listeningFor, setListeningFor] = useState(null) // RetroPad index awaiting a press

  // The controller map in force right now: the chosen scheme, plus anything the
  // player has rebound on THIS controller.
  const controls = {
    scheme: settings.controlScheme,
    custom: bindingsFor(settings, padId),
  }
  const mode = resolveInputMode({
    override: settings.inputMode,
    padActive,
    hasTouch: navigator.maxTouchPoints > 0,
  })

  // Hand the engine its config. Assigned during render, NOT in an effect: React
  // creates the <iframe> DOM node on commit — i.e. after this function returns —
  // so the player document is guaranteed to find it set when its inline script
  // runs. An effect would race the iframe's own load.
  window.HQ_PLAYER_CONFIG = playerConfig(core, controls, { name, coverUrl: coverUrl(id) })

  // Wait for the user to tap the engine's Start button, then take the handle.
  // Aborted on unmount: backing out of a game before ever tapping Start would
  // otherwise leave that promise pending for the life of the tab.
  const abortRef = useRef(null)
  useEffect(() => {
    const ctl = new AbortController()
    abortRef.current = ctl
    return () => ctl.abort()
  }, [])

  const onFrameLoad = useCallback(() => {
    frameRef.current?.contentWindow?.focus?.()
    // Both of these must happen BEFORE the engine builds anything: they patch the
    // player document's own constructors. trackAudio catches its AudioContext;
    // preserveCanvas makes its WebGL canvas readable, so a save state can have a
    // picture on it instead of a black rectangle.
    trackAudio(frameRef.current)
    preserveCanvas(frameRef.current) // belt-and-braces; emulator.html does it first
    // The frog is the loading screen. It fills with the colour of the machine you're
    // about to play — the same costume it was wearing on Frog's shelf a moment ago,
    // which is the thread that makes the handoff feel like one app instead of two.
    const accent = systemStyle(label || systemForCore(core)).accent
    styleStartScreen(frameRef.current, {
      coverUrl: coverUrl(id),
      name,
      loader: {
        svg: frogLoaderSvg({ rgb: accent, ground: FROG.ground }),
        css: frogLoaderCss({ rgb: accent }),
        fill: nextFill,
        label: phaseLabel,
      },
    })
    dispatch('engine-loaded')
    attachEmu(frameRef.current, { signal: abortRef.current?.signal }).then((emu) => {
      // No engine = the player document is older than this bundle (its cached
      // copy hasn't refreshed yet) or the engine failed to load. Leave the
      // engine's own UI alone and don't dispatch 'started' — the user gets the
      // stock player, which still works, rather than a half-wired one.
      if (!emu) return
      emuRef.current = emu
      // The game is running: the start screen has done its job and must LEAVE. The
      // engine only ever removed its own Start button, so without this the box art
      // sits in the middle of the game, still bobbing.
      clearStartScreen(frameRef.current)
      dispatch('started')
    })
  }, [])

  // Suppress the engine's own UI: its bottom bar and context menu always (the HQ
  // pause menu replaces them), and its touch pad whenever a controller is driving
  // — THAT is controller mode. Re-applied whenever the mode flips, because picking
  // up the pad mid-game has to clear the on-screen buttons out of the way.
  //
  // It has to be CSS. The engine re-shows its touch pad from two places we can't
  // intercept: it force-shows it if Start was tapped with a finger, and every
  // resize (which includes every rotation) un-hides it for 250ms. JS loses that
  // race; `display: none !important` doesn't.
  useEffect(() => {
    if (!emuRef.current) return
    killEngineChrome(frameRef.current, {
      menuBar: true,
      contextMenu: true,
      // The engine's touch pad is gone for good now: on a controller there are no
      // on-screen controls at all, and on touch our own overlay replaces it.
      virtualGamepad: true,
    })
  }, [mode, state])

  // Re-map the running game whenever the scheme or a binding changes. The engine
  // reads emu.controls on every button event, so this takes effect on the very next
  // press — you can feel the change while still holding the pad.
  useEffect(() => {
    if (!emuRef.current) return
    applyControls(emuRef.current, controls)
  }, [state, settings.controlScheme, settings.controlBindings, padId])

  // Pause the core whenever we're not in PLAYING, and release every button on
  // the way back in — a button held down when the menu opened would stay latched
  // in the core, and the game would resume walking into a wall.
  useEffect(() => {
    const emu = emuRef.current
    if (!emu) return
    const running = isRunning(state)
    setPaused(emu, !running)
    if (running) flushInputs(emu)
  }, [state])

  const exit = useCallback(() => {
    // Offline, the game's detail page needs the live API — so a downloaded game
    // exits to Downloads instead of dead-ending on "that game isn't in the
    // library".
    goBack(navigate, online ? `/library/games/detail?id=${encodeURIComponent(id)}` : '/library/downloads')
  }, [navigate, online, id])

  const openShelf = useCallback(async () => {
    setShelfOpen(true)
    setError(null)
    setStatesLoading(true)
    setStates(await listStates(id))
    setStatesLoading(false)
  }, [id])

  const doSave = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await saveState(emuRef.current, id)
      // The local copy always lands; only the upload can fail. Say so rather than
      // claiming success, but don't treat it as an error — the state is safe on
      // this device and the game will still resume from it.
      if (res.offline) setError('Saved on this device. It’ll sync to your other devices when you’re back online.')
      setStates(await listStates(id))
    } catch (e) {
      setError(e?.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }, [id])

  const doLoad = useCallback(
    async (slot) => {
      setBusy(true)
      setError(null)
      try {
        await loadState(emuRef.current, id, slot)
        setShelfOpen(false)
        dispatch('resume') // straight back into the game — no reboot
      } catch (e) {
        setError(e?.message || 'Could not load that state.')
      } finally {
        setBusy(false)
      }
    },
    [id]
  )

  const doDelete = useCallback(
    async (slot) => {
      await deleteState(id, slot)
      setStates(await listStates(id))
    },
    [id]
  )

  // Native fullscreen where it exists (desktop, and iPad behind a prefix); a CSS
  // immersive mode everywhere else. iPhone Safari has no Fullscreen API at all —
  // there, the installed PWA is what gets you a chromeless screen.
  //
  // Fullscreens the WRAPPER, not the iframe: the pause menu and the touch controls
  // live in the parent document, so fullscreening the iframe alone would put the
  // game on screen with none of its controls.
  const goFullscreen = useCallback(() => {
    const el = wrapperRef.current
    const req = el?.requestFullscreen || el?.webkitRequestFullscreen
    if (req) {
      Promise.resolve(req.call(el)).catch(() => setImmersive(true))
    } else {
      setImmersive(true)
    }
  }, [])

  // One place that writes settings, so localStorage and React state can't drift.
  const saveSettings = useCallback((next) => {
    setSettings(next)
    writeSettings(window.localStorage, next)
  }, [])

  const openControls = useCallback(() => {
    setControlsFocus(0)
    setListeningFor(null)
    setControlsOpen(true)
  }, [])

  const closeControls = useCallback(() => {
    setControlsOpen(false)
    setListeningFor(null)
  }, [])

  const chooseScheme = useCallback(
    (scheme) => saveSettings({ ...settings, controlScheme: scheme }),
    [settings, saveSettings]
  )

  const resetBindings = useCallback(
    () => saveSettings(clearBindings(settings, padId)),
    [settings, padId, saveSettings]
  )

  // "Press a button…" — the next press on the pad becomes this button's binding.
  // Returns true from onRawButton to swallow that press, so it doesn't also
  // navigate the menu it was made in.
  const captureBinding = useCallback(
    (buttonIndex, id) => {
      if (listeningFor == null) return false

      // The Menu button is the app's (short press = the game's START, long press =
      // this menu). Handing it to the game as well would make every long press do
      // both, so it's the one button you can't have.
      const label = bindingForButton(buttonIndex)
      if (!label) {
        setError('That button belongs to the app — pick another.')
        setListeningFor(null)
        return true
      }
      saveSettings(withBinding(settings, id || padId, listeningFor, label))
      setListeningFor(null)
      return true
    },
    [listeningFor, settings, padId, saveSettings]
  )

  const onMenuAction = useCallback(
    (action) => {
      const emu = emuRef.current
      switch (action) {
        case 'resume':
          dispatch('resume')
          break
        case 'save':
        case 'load':
          openShelf()
          break
        case 'fastForward': {
          const on = !fastForward
          setFastForward(emu, on)
          setFF(on)
          dispatch('resume') // fast-forward is something you want to SEE
          break
        }
        case 'controls':
          openControls()
          break
        case 'fullscreen':
          goFullscreen()
          dispatch('resume')
          break
        case 'restart':
          restartGame(emu)
          dispatch('resume')
          break
        case 'quit':
          dispatch('quit')
          exit()
          break
        default:
          break
      }
    },
    [fastForward, openShelf, exit, goFullscreen, openControls]
  )

  const openMenu = useCallback(() => {
    setMenuFocus(0)
    dispatch('pause')
  }, [])

  const paused = state === 'PAUSED'

  // Hide the top bar while you're actually playing on a phone or a controller, and
  // give the game the whole screen. It's ~48px, which is a lot on a 393px-tall
  // landscape phone: with the bar up, the controls letterbox down to a scale where
  // the menu button lands under the 44pt minimum touch target.
  //
  // Safe because it isn't the only way out: the overlay carries a ☰, the pad has
  // its Menu button, both open the pause menu, and the pause menu has Quit. (On a
  // desktop, with neither, the bar stays.)
  // Which way up the device is. Drives the touch layout, the game's box, and the
  // rotate prompt.
  const portrait = useMediaQuery('(orientation: portrait)')

  // iPhone has no Fullscreen API, so the button is a no-op there and isn't shown.
  const canFullscreen = supportsFullscreen()

  const chromeless = isRunning(state) && (mode === 'touch' || padActive)

  // Held upright, the game goes across the top and the controls fill the space
  // below it — so the iframe has to give up the bottom half. In landscape it stays
  // full-bleed with the controls floating over it.
  const portraitTouch = mode === 'touch' && portrait && isRunning(state)

  // --- the touch controls ---------------------------------------------------

  // Straight through to the core. Stable identities: TouchOverlay re-installs its
  // native listeners when these change, and doing that on every render would drop
  // touches mid-press.
  const onTouchInput = useCallback((index, down) => {
    press(emuRef.current, index, down)
  }, [])

  const onTouchAction = useCallback(
    (action) => {
      if (action === 'pauseMenu') openMenu()
      else if (action === 'fastForward') {
        const on = !fastForward
        setFastForward(emuRef.current, on)
        setFF(on)
      }
    },
    [fastForward, openMenu]
  )

  // --- the physical controller ---------------------------------------------

  // While our menu is open, stop the engine's own gamepad handler from feeding
  // the game: otherwise the same D-pad press that moves the menu cursor is ALSO
  // driving the (paused) character underneath it. Wrapped, not replaced — the
  // engine keeps exactly one listener per event, so overwriting would kill its
  // input handling outright.
  const menuOpenRef = useRef(false)
  menuOpenRef.current = paused || shelfOpen || controlsOpen
  useEffect(() => {
    const emu = emuRef.current
    if (!emu) return
    return gateEngineGamepad(emu, () => menuOpenRef.current)
  }, [state === 'PLAYING']) // re-install once the engine exists

  const menuItems = pauseItems(fastForward, { canFullscreen })

  const rows = controlRows()

  useGamepad({
    onPadButton: (id) => {
      setPadActive(true)
      setPadId(id)
      // The pad's id is "<name>:<index>" — the name is what a human recognises.
      setPadName((id || '').split(':')[0] || null)
    },
    onDisconnect: () => setPadActive(false),

    // While the Controls screen is waiting for a press, that press IS the binding —
    // it must not also move the cursor. Returning true swallows it.
    onRawButton: (index, id) => captureBinding(index, id),

    // The Menu button is ours alone (START is left unbound in the preset, so this
    // can't double-fire): a short press is the game's START, a long press opens
    // the HQ menu.
    onMenuAction: (action) => {
      if (action === 'pauseMenu') {
        // Back out one layer at a time. Resuming straight from a panel would
        // un-pause the game while that panel still covered it (and leave the
        // engine's gamepad gated, so the pad would drive nothing).
        if (controlsOpen) closeControls()
        else if (shelfOpen) setShelfOpen(false)
        else if (paused) dispatch('resume')
        else openMenu()
      } else if (action === 'start' && !menuOpenRef.current) {
        tap(emuRef.current, RETROPAD.START)
      }
    },

    // Menu navigation. Only wired while a menu is open — in-game the engine reads
    // the pad itself, straight from the preset.
    onAction: (action) => {
      if (!menuOpenRef.current) return

      if (controlsOpen) {
        // A one-column list, so up/down walk it and left/right do nothing.
        if (action === 'back') closeControls()
        else if (action === 'confirm') {
          const row = rows[controlsFocus]
          if (row === 'reset') resetBindings()
          else if (row.startsWith('bind:')) setListeningFor(Number(row.slice(5)))
          else chooseScheme(row)
        } else if (action === 'up' || action === 'down') {
          setControlsFocus((i) => moveInGrid({ count: rows.length, cols: 1, index: i }, action))
        }
        return
      }

      if (shelfOpen) {
        if (action === 'back') setShelfOpen(false)
        return
      }
      if (action === 'confirm') onMenuAction(menuItems[menuFocus].id)
      else if (action === 'back') dispatch('resume')
      else
        setMenuFocus((i) =>
          moveInGrid({ count: menuItems.length, cols: pauseCols(menuItems.length), index: i }, action, {
            centerLastRow: true,
          })
        )
    },

    // The analog stick as a d-pad, in-game only. These systems have no analog
    // input, so the engine's preset can't bind the stick — without this it'd be
    // dead, and it's the first thing a thumb reaches for on an Xbox pad.
    onStick: (dir, down) => {
      if (menuOpenRef.current) return
      const index = { up: RETROPAD.UP, down: RETROPAD.DOWN, left: RETROPAD.LEFT, right: RETROPAD.RIGHT }[dir]
      if (index != null) press(emuRef.current, index, down)
    },
  })

  // The controller hint introduces itself and then leaves. It answers exactly one
  // question — "the on-screen controls vanished, how do I get back to a menu?" —
  // and once you know, it's just something parked over the corner of your game for
  // the rest of the session. So: a few seconds, then fade out.
  //
  // Re-armed whenever the pad reconnects, because that's when you might have picked
  // up a different controller, or handed it to someone who hasn't seen it.
  useEffect(() => {
    if (!padActive) return
    setPadHint(true)
    const t = setTimeout(() => setPadHint(false), 4500)
    return () => clearTimeout(t)
  }, [padActive])

  // The battery save — the game's own "Save", the one that costs you hours.
  //
  // Owned HERE, in the parent, and not inside the player document. The iframe is the
  // thing that gets destroyed when you quit, so every write it started died with it:
  // quit shortly after saving and the save was gone. This survives the teardown, so
  // it can read the save out of the engine on the way out and actually write it down.
  useGameSaves(emuRef, id, state === 'PLAYING' || state === 'PAUSED')

  // Don't let the screen sleep mid-game. Re-acquired on every return to the tab,
  // because iOS drops the lock whenever the page is hidden and never gives it back.
  useWakeLock(isRunning(state))

  // --- immersion ------------------------------------------------------------

  // Ask a controller user to turn the device. We can't force it: iOS ignores the
  // manifest's orientation key and keeps screen.orientation.lock() behind an
  // experimental flag. Touch play is left alone — it has a real portrait layout.
  useEffect(() => {
    // `state` is in the deps on purpose: this bails out until the engine exists,
    // and neither `portrait` nor `mode` changes when the game finally starts — so
    // without it, a device already held in portrait at boot is never prompted.
    if (!emuRef.current) return
    if (shouldPromptRotate({ mode, portrait, padActive })) dispatch('rotate-portrait')
    else dispatch('rotate-landscape')
  }, [portrait, mode, padActive, state])

  // Escape opens the pause menu from the keyboard, so a desktop player has the
  // same way in as the pad's Menu button. (Once it's open, PauseMenu owns the
  // keys — arrows to move, Enter to pick, Escape to resume.)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || !isRunning(state)) return
      e.preventDefault()
      openMenu()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, openMenu])

  // Pause when the app goes to the background, and flush the battery save on the
  // way out — an iOS tab can be discarded without warning, and an unsaved SRAM is
  // hours of someone's game.
  useEffect(() => {
    const onVisibility = () => dispatch(document.visibilityState === 'visible' ? 'visible' : 'hidden')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Keep the game's audio alive. iOS suspends the player document's AudioContext
  // whenever it feels like it, and only a gesture can restart it — but our controls
  // live out here and swallow every touch, so the player document would never get
  // one again. Capture phase, so it still runs even though the overlay
  // preventDefaults; and synchronous, because iOS ignores a deferred resume.
  useEffect(() => {
    const wake = () => resumeAudio(frameRef.current)
    for (const ev of ['pointerdown', 'touchstart', 'keydown']) {
      window.addEventListener(ev, wake, { capture: true, passive: true })
    }
    document.addEventListener('visibilitychange', wake)
    return () => {
      for (const ev of ['pointerdown', 'touchstart', 'keydown']) {
        window.removeEventListener(ev, wake, { capture: true })
      }
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])

  // Kill the browser's own touch gestures inside the player. Without this, a
  // thumb on the d-pad drags the page, a two-finger press zooms the game, and a
  // downward swipe pull-to-refreshes the whole app mid-boss.
  //
  // gesturestart is WebKit-only and must be registered non-passively or the
  // preventDefault is ignored, which is exactly the kind of thing that silently
  // does nothing and looks like it works.
  useEffect(() => {
    const stop = (e) => e.preventDefault()
    document.addEventListener('gesturestart', stop, { passive: false })
    document.addEventListener('gesturechange', stop, { passive: false })
    return () => {
      document.removeEventListener('gesturestart', stop)
      document.removeEventListener('gesturechange', stop)
    }
  }, [])


  return (
    <div
      ref={wrapperRef}
      // touch-action/overscroll/user-select: the player owns every touch inside
      // it. Otherwise a thumb resting on the d-pad scrolls the page, a swipe down
      // pull-to-refreshes the app mid-game, and a long press pops the iOS
      // text-selection callout over the controls.
      className="fixed inset-0 z-50 flex touch-none select-none flex-col overscroll-none bg-black [-webkit-touch-callout:none]"
      // With no top bar, the wrapper is what keeps the game clear of the iOS
      // status bar (the clock/battery strip) and the home indicator. Without this
      // the game runs underneath them and its top edge is simply cut off.
      //
      // TouchOverlay therefore does NOT pad itself — it letterboxes inside this
      // already-safe box. Padding in both places would inset twice and shrink
      // everything straight back down.
      style={
        immersive || chromeless
          ? {
              paddingTop: 'env(safe-area-inset-top)',
              paddingRight: 'env(safe-area-inset-right)',
              paddingBottom: 'env(safe-area-inset-bottom)',
              paddingLeft: 'env(safe-area-inset-left)',
            }
          : undefined
      }
    >
      {chromeless ? null : immersive ? (
        <div className="flex items-center px-2 pb-1">
          <button
            onClick={() => setImmersive(false)}
            className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-800/90 px-3 py-1.5 text-sm font-medium text-slate-100 ring-1 ring-white/30 active:bg-slate-700"
          >
            <Minimize className="h-4 w-4" aria-hidden="true" /> Exit Fullscreen
          </button>
        </div>
      ) : (
        <div
          className="flex items-center gap-2 bg-slate-900 px-3 py-2"
          style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
        >
          {/* Always mounted, outside the overlay tree: we've taken the engine's
              own exit away, so if the overlay ever crashed this is the way out. */}
          <button
            onClick={exit}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 active:bg-slate-700"
          >
            <X className="h-4 w-4" aria-hidden="true" /> Exit
          </button>
          <span className="min-w-0 flex-1 truncate text-center font-medium text-slate-100">{name}</span>
          {canFullscreen && (
            <button
              onClick={goFullscreen}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded bg-slate-800 px-3 py-1.5 text-sm text-slate-200 active:bg-slate-700"
            >
              <Maximize className="h-4 w-4" aria-hidden="true" /> Fullscreen
            </button>
          )}
        </div>
      )}

      <div className="relative min-h-0 w-full flex-1">
        <iframe
          ref={frameRef}
          title={name}
          src={playerSrc({ id, core, name, loadStateUrl })}
          onLoad={onFrameLoad}
          className="w-full border-0 bg-black"
          style={{ height: portraitTouch ? PORTRAIT_GAME_HEIGHT : '100%' }}
          allow="autoplay; fullscreen; gamepad"
          allowFullScreen
        />

        {/* The touch controls. Mounted only once the game is actually RUNNING —
            any earlier and this surface would swallow the tap on the engine's own
            Start button, which is the gesture that unlocks audio on iOS. */}
        {overlayVisible(state, mode) && (
          <TouchOverlay
            core={core}
            orientation={portrait ? 'portrait' : 'landscape'}
            opacity={settings.touchOpacity}
            fastForward={fastForward}
            onInput={onTouchInput}
            onAction={onTouchAction}
          />
        )}

        {/* The way into the pause menu when there's no touch overlay to carry the
            ☰ button and no controller to hold Menu on — i.e. an ordinary desktop
            browser. Without this there is NO way to save, load, restart or
            fast-forward there at all. */}
        {isRunning(state) && !overlayVisible(state, mode) && !padActive && (
          <button
            onClick={openMenu}
            aria-label="Game menu"
            className="absolute left-2 top-2 z-10 rounded-full bg-slate-900/70 p-2 text-slate-200 backdrop-blur-sm hover:bg-slate-800 active:bg-slate-800"
            style={{ marginTop: 'env(safe-area-inset-top)', marginLeft: 'env(safe-area-inset-left)' }}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        )}

        {/* Says the pad took over, and how to get back to a menu now that the
            on-screen button is gone. Then it fades — see the timer above. */}
        {isRunning(state) && mode === 'pad' && padActive && (
          <div
            data-testid="pad-hint"
            aria-hidden={!padHint}
            className={`pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-slate-900/70 px-3 py-1.5 text-xs text-slate-300 backdrop-blur-sm transition-opacity duration-700 ${
              padHint ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ marginTop: 'env(safe-area-inset-top)', marginRight: 'env(safe-area-inset-right)' }}
          >
            Controller · hold <span className="font-semibold text-slate-100">☰</span> for the menu
          </div>
        )}

        <PauseMenu
          open={paused && !shelfOpen}
          name={name}
          fastForward={fastForward}
          canFullscreen={canFullscreen}
          focus={menuFocus}
          onFocus={setMenuFocus}
          onAction={onMenuAction}
          legend={
            mode === 'pad' ? (
              <ButtonLegend
                hints={[
                  { button: 'A', label: 'Select' },
                  { button: 'B', label: 'Resume' },
                  { button: '☰', label: 'Close' },
                ]}
              />
            ) : null
          }
        />

        {controlsOpen && (
          <ControlsPanel
            padName={padName}
            scheme={settings.controlScheme}
            bindings={bindingsFor(settings, padId)}
            listeningFor={listeningFor}
            focus={controlsFocus}
            onFocus={setControlsFocus}
            onScheme={chooseScheme}
            onListen={setListeningFor}
            onReset={resetBindings}
            onBack={closeControls}
          />
        )}

        {state === 'ROTATE' && <RotatePrompt />}

        {shelfOpen && (
          <SaveStatePanel
            gameId={id}
            states={states}
            loading={statesLoading}
            busy={busy}
            error={error}
            onSave={doSave}
            onLoad={doLoad}
            onDelete={doDelete}
            onBack={() => {
              setShelfOpen(false)
              setError(null)
            }}
          />
        )}
      </div>
    </div>
  )
}
