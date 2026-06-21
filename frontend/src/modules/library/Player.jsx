import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { playerSrc, saveStateUrl } from '../../lib/library.js'
import { useOnline } from '../../lib/online.jsx'
import { goBack } from '../../lib/nav.js'

// Full-screen game player. The emulator runs inside an isolated <iframe>
// (emulator.html) so unmounting this route fully tears the engine down. It's a
// real route, so the phone back gesture exits the game. We deliberately DON'T
// auto-fullscreen — the top bar's "Exit" (back to the game's detail page) stays
// visible, which is the only way out in the installed PWA (no browser chrome).
// Overlays the shell (fixed inset-0) for an immersive, mobile-first view.
export default function Player() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { online } = useOnline()
  const frameRef = useRef(null)
  // CSS-immersive fallback for platforms without the Fullscreen API (iOS
  // Safari / installed PWAs don't implement requestFullscreen on non-video
  // elements, so the native call no-ops there). When true, swap the full top
  // bar for a slim strip with just a "back to menu" button, so the game gets
  // almost the whole screen without anything overlapping it.
  const [immersive, setImmersive] = useState(false)

  const id = params.get('id')
  const core = params.get('core')
  const name = params.get('name') || 'Game'
  const slot = params.get('slot') // present when resuming a saved state
  const loadStateUrl = slot ? saveStateUrl(id, slot) : undefined

  if (!id || !core) {
    return (
      <div className="p-6 text-rose-400">
        Missing game.{' '}
        <button onClick={() => navigate('/library/games')} className="underline">
          Back to Games
        </button>
      </div>
    )
  }

  // Exit back to where you came from (history-back). Falls back to the game's
  // detail page online, or — since that page needs the live API — to Downloads
  // when offline, so exiting a downloaded game never dead-ends on "That game
  // isn't in the library".
  const exitToDetail = () =>
    goBack(navigate, online ? `/library/games/detail?id=${encodeURIComponent(id)}` : '/library/downloads')

  // Native fullscreen where supported (desktop); CSS immersive otherwise (iOS).
  const goFullscreen = () => {
    const el = frameRef.current
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => setImmersive(true))
    } else {
      setImmersive(true)
    }
  }

  // In immersive mode, pad the container by the safe-area insets so the iframe
  // (and the emulator's own top-right menu) clears the notch / curved corners
  // instead of being clipped + unreachable. The single iframe stays mounted
  // across the toggle, so entering/leaving fullscreen never reloads the game.
  return (
    <div
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
        // Slim strip above the game (in-flow, so the iframe starts below it and
        // nothing overlaps). The container's safe-area padding already clears
        // the notch. Right-aligned on purpose: the fullscreen toggle lives on
        // the right in both states, so leaving fullscreen doesn't drop your
        // finger onto the "Exit" button that reappears on the left.
        <div className="flex items-center px-2 pb-1">
          <button
            onClick={() => setImmersive(false)}
            className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-slate-800/90 px-3 py-1.5 text-sm font-medium text-slate-100 ring-1 ring-white/30 active:bg-slate-700"
          >
            ⤡ Exit Fullscreen
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 bg-slate-900 px-3 py-2" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
          <button
            onClick={exitToDetail}
            className="shrink-0 whitespace-nowrap rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 active:bg-slate-700"
          >
            ✕ Exit
          </button>
          <span className="min-w-0 flex-1 truncate text-center font-medium text-slate-100">{name}</span>
          <button
            onClick={goFullscreen}
            className="shrink-0 whitespace-nowrap rounded bg-slate-800 px-3 py-1.5 text-sm text-slate-200 active:bg-slate-700"
          >
            ⛶ Fullscreen
          </button>
        </div>
      )}
      <iframe
        ref={frameRef}
        title={name}
        src={playerSrc({ id, core, name, loadStateUrl })}
        onLoad={() => frameRef.current?.contentWindow?.focus?.()}
        className="min-h-0 w-full flex-1 border-0 bg-black"
        allow="autoplay; fullscreen; gamepad"
        allowFullScreen
      />
    </div>
  )
}
