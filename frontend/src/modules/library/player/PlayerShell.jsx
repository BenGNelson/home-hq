import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Menu, Maximize, Minimize } from 'lucide-react'
import { playerSrc } from '../../../lib/library.js'
import { useOnline } from '../../../lib/online.jsx'
import { goBack } from '../../../lib/nav.js'
import {
  playerConfig,
  attachEmu,
  killEngineChrome,
  flushInputs,
  setPaused,
  setFastForward,
  restart as restartGame,
} from '../../../lib/emuBridge.js'
import { nextPlayerState, INITIAL_PLAYER_STATE, isRunning } from '../../../lib/playerMode.js'
import { saveState, loadState, listStates, deleteState } from '../../../lib/saveStates.js'
import PauseMenu from './PauseMenu.jsx'
import SaveStatePanel from './SaveStatePanel.jsx'

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

  // Hand the engine its config. Assigned during render, NOT in an effect: React
  // creates the <iframe> DOM node on commit — i.e. after this function returns —
  // so the player document is guaranteed to find it set when its inline script
  // runs. An effect would race the iframe's own load.
  window.HQ_PLAYER_CONFIG = playerConfig()

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
      // Suppress the engine's bottom bar + context menu now that the HQ pause
      // menu replaces them. Its touch gamepad stays for now — the custom overlay
      // that replaces THAT lands in a later milestone, and removing it before
      // then would leave a phone with no controls at all.
      killEngineChrome(frameRef.current, { menuBar: true, contextMenu: true })
      dispatch('started')
    })
  }, [])

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

  const openMenu = () => {
    setMenuFocus(0)
    dispatch('pause')
  }

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

  const paused = state === 'PAUSED'

  return (
    <div
      ref={wrapperRef}
      className="fixed inset-0 z-50 flex flex-col bg-black"
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

        {/* The menu button only appears once the game is actually running, so it
            can never sit over the engine's Start button and steal the tap that
            unlocks audio on iOS. */}
        {isRunning(state) && (
          <button
            onClick={openMenu}
            aria-label="Game menu"
            className="absolute left-2 top-2 z-10 rounded-full bg-slate-900/70 p-2 text-slate-200 backdrop-blur-sm active:bg-slate-800"
            style={{ marginTop: 'env(safe-area-inset-top)', marginLeft: 'env(safe-area-inset-left)' }}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        )}

        <PauseMenu
          open={paused && !shelfOpen}
          name={name}
          fastForward={fastForward}
          focus={menuFocus}
          onFocus={setMenuFocus}
          onAction={onMenuAction}
        />

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
