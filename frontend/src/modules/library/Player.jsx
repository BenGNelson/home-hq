import { useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { playerSrc, saveStateUrl } from '../../lib/library.js'

// Full-screen game player. The emulator runs inside an isolated <iframe>
// (emulator.html) so unmounting this route fully tears the engine down. It's a
// real route, so the phone back gesture exits the game. We deliberately DON'T
// auto-fullscreen — the top bar's "Exit" stays visible, which is the only way
// out in the installed PWA (no browser chrome). Overlays the shell (fixed
// inset-0) for an immersive, mobile-first view.
export default function Player() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const frameRef = useRef(null)

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

  const goFullscreen = () => frameRef.current?.requestFullscreen?.()

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center gap-3 bg-slate-900 px-3 py-2" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <button
          onClick={() => navigate('/library/games')}
          className="rounded bg-slate-800 px-3 py-1 text-sm font-medium text-slate-100 active:bg-slate-700"
        >
          ✕ Exit
        </button>
        <span className="truncate font-medium text-slate-100">{name}</span>
        <button
          onClick={goFullscreen}
          className="ml-auto rounded bg-slate-800 px-3 py-1 text-sm text-slate-200 active:bg-slate-700"
        >
          Fullscreen
        </button>
      </div>
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
