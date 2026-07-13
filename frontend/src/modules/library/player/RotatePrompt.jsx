import { RotateCw, Smartphone } from 'lucide-react'
import { sectionAccent } from '../../../lib/library.js'
import { radiantBackdrop, glowFilter } from '../../../lib/glow.js'

const GAMES = sectionAccent('games')

// "Turn your device sideways."
//
// We can't just force landscape: iOS ignores the PWA manifest's `orientation`
// key, and screen.orientation.lock() sits behind an off-by-default experimental
// flag in Safari. Detecting and asking is the only honest option — so the game
// pauses, this covers the screen, and it resumes the moment the device turns.
//
// Controller mode only. Touch play has a real portrait layout (game on top,
// thumbs below); it's the controller that has nothing to put in the empty half of
// a portrait screen.
export default function RotatePrompt() {
  return (
    <div
      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-slate-950/95 text-center"
      role="status"
    >
      <div className="pointer-events-none absolute inset-0" style={{ background: radiantBackdrop(GAMES.rgb, 0.16) }} />

      <div className="relative flex items-center gap-3 text-violet-300" style={{ filter: glowFilter(GAMES.rgb, 0.7) }}>
        <Smartphone className="h-12 w-12 rotate-90" aria-hidden="true" />
        <RotateCw className="h-6 w-6 animate-[spin_2.5s_linear_infinite]" aria-hidden="true" />
      </div>

      <div className="relative px-8">
        <p className="text-lg font-semibold text-slate-100">Turn your device sideways</p>
        <p className="mt-1 text-sm text-slate-400">Your game is paused. It’ll pick up right where you left it.</p>
      </div>
    </div>
  )
}
