import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Menu, Maximize, Minimize } from 'lucide-react'
import { playerSrc } from '../../../lib/library.js'
import { useOnline } from '../../../lib/online.jsx'
import { goBack } from '../../../lib/nav.js'
import {
  RETROPAD,
  playerConfig,
  attachEmu,
  killEngineChrome,
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
} from '../../../lib/playerMode.js'
import { readSettings, migrateLegacyEjsKeys } from '../../../lib/playerSettings.js'
import { useGamepad } from '../../../lib/useGamepad.js'
import { useWakeLock } from '../../../lib/useWakeLock.js'
import { useMediaQuery } from '../../../lib/useMediaQuery.js'
import { moveInGrid } from '../../../lib/gridNav.js'
import { saveState, loadState, listStates, deleteState } from '../../../lib/saveStates.js'
import PauseMenu, { pauseItems, PAUSE_COLS } from './PauseMenu.jsx'
import SaveStatePanel from './SaveStatePanel.jsx'
import ButtonLegend from './ButtonLegend.jsx'
import RotatePrompt from './RotatePrompt.jsx'
import TouchOverlay from './TouchOverlay.jsx'

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
export default function PlayerShell({ id, core, name, loadStateUrl }) {
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
  const [settings] = useState(() => {
    // The engine's localStorage is off now (it would overwrite our control
    // preset), so its old per-game blobs are dead bytes. Sweep them once.
    migrateLegacyEjsKeys(window.localStorage)
    return readSettings(window.localStorage)
  })
  const mode = resolveInputMode({
    override: settings.inputMode,
    padActive,
    hasTouch: navigator.maxTouchPoints > 0,
  })

  // Hand the engine its config. Assigned during render, NOT in an effect: React
  // creates the <iframe> DOM node on commit — i.e. after this function returns —
  // so the player document is guaranteed to find it set when its inline script
  // runs. An effect would race the iframe's own load.
  window.HQ_PLAYER_CONFIG = playerConfig(core)

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
    dispatch('engine-loaded')
    attachEmu(frameRef.current, { signal: abortRef.current?.signal }).then((emu) => {
      // No engine = the player document is older than this bundle (its cached
      // copy hasn't refreshed yet) or the engine failed to load. Leave the
      // engine's own UI alone and don't dispatch 'started' — the user gets the
      // stock player, which still works, rather than a half-wired one.
      if (!emu) return
      emuRef.current = emu
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
    [fastForward, openShelf, exit]
  )

  const openMenu = useCallback(() => {
    setMenuFocus(0)
    dispatch('pause')
  }, [])

  const paused = state === 'PAUSED'

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
  menuOpenRef.current = paused || shelfOpen
  useEffect(() => {
    const emu = emuRef.current
    if (!emu) return
    return gateEngineGamepad(emu, () => menuOpenRef.current)
  }, [state === 'PLAYING']) // re-install once the engine exists

  const menuItems = pauseItems(fastForward)

  useGamepad({
    onPadButton: () => setPadActive(true),
    onDisconnect: () => setPadActive(false),

    // The Menu button is ours alone (START is left unbound in the preset, so this
    // can't double-fire): a short press is the game's START, a long press opens
    // the HQ menu.
    onMenuAction: (action) => {
      if (action === 'pauseMenu') {
        // Back out one layer at a time. Resuming straight from the shelf would
        // un-pause the game while the save-state list is still covering it (and
        // leave the engine's gamepad gated, so the pad would drive nothing).
        if (shelfOpen) setShelfOpen(false)
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
      if (shelfOpen) {
        if (action === 'back') setShelfOpen(false)
        return
      }
      if (action === 'confirm') onMenuAction(menuItems[menuFocus].id)
      else if (action === 'back') dispatch('resume')
      else setMenuFocus((i) => moveInGrid({ count: menuItems.length, cols: PAUSE_COLS, index: i }, action))
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

  // Don't let the screen sleep mid-game. Re-acquired on every return to the tab,
  // because iOS drops the lock whenever the page is hidden and never gives it back.
  useWakeLock(isRunning(state))

  // --- immersion ------------------------------------------------------------

  // Ask a controller user to turn the device. We can't force it: iOS ignores the
  // manifest's orientation key and keeps screen.orientation.lock() behind an
  // experimental flag. Touch play is left alone — it has a real portrait layout.
  const portrait = useMediaQuery('(orientation: portrait)')
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

  // Native fullscreen where it exists (desktop, and iPad behind a prefix); a CSS
  // immersive mode everywhere else. iPhone Safari has no Fullscreen API at all —
  // there, the installed PWA is what gets you a chromeless screen.
  //
  // Fullscreens the WRAPPER, not the iframe: the pause menu and (later) the touch
  // controls live in the parent document, so fullscreening the iframe alone would
  // put the game on screen with none of its controls.
  const goFullscreen = () => {
    const el = wrapperRef.current
    const req = el?.requestFullscreen || el?.webkitRequestFullscreen
    if (req) {
      Promise.resolve(req.call(el)).catch(() => setImmersive(true))
    } else {
      setImmersive(true)
    }
  }

  return (
    <div
      ref={wrapperRef}
      // touch-action/overscroll/user-select: the player owns every touch inside
      // it. Otherwise a thumb resting on the d-pad scrolls the page, a swipe down
      // pull-to-refreshes the app mid-game, and a long press pops the iOS
      // text-selection callout over the controls.
      className="fixed inset-0 z-50 flex touch-none select-none flex-col overscroll-none bg-black [-webkit-touch-callout:none]"
      style={
        immersive
          ? {
              paddingTop: 'env(safe-area-inset-top)',
              paddingRight: 'env(safe-area-inset-right)',
              paddingBottom: 'env(safe-area-inset-bottom)',
              paddingLeft: 'env(safe-area-inset-left)',
            }
          : undefined
      }
    >
      {immersive ? (
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
          <button
            onClick={goFullscreen}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded bg-slate-800 px-3 py-1.5 text-sm text-slate-200 active:bg-slate-700"
          >
            <Maximize className="h-4 w-4" aria-hidden="true" /> Fullscreen
          </button>
        </div>
      )}

      <div className="relative min-h-0 w-full flex-1">
        <iframe
          ref={frameRef}
          title={name}
          src={playerSrc({ id, core, name, loadStateUrl })}
          onLoad={onFrameLoad}
          className="h-full w-full border-0 bg-black"
          allow="autoplay; fullscreen; gamepad"
          allowFullScreen
        />

        {/* The touch controls. Mounted only once the game is actually RUNNING —
            any earlier and this surface would swallow the tap on the engine's own
            Start button, which is the gesture that unlocks audio on iOS. */}
        {overlayVisible(state, mode) && (
          <TouchOverlay
            core={core}
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

        {/* Tells you the pad took over — and, crucially, how to get back out,
            since the on-screen menu button is now gone. */}
        {isRunning(state) && mode === 'pad' && padActive && (
          <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-slate-900/70 px-3 py-1.5 text-xs text-slate-300 backdrop-blur-sm">
            Controller · hold <span className="font-semibold text-slate-100">☰</span> for the menu
          </div>
        )}

        <PauseMenu
          open={paused && !shelfOpen}
          name={name}
          fastForward={fastForward}
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
