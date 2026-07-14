import { useEffect, useRef, useState } from 'react'
import { coverUrl } from '../../../lib/library.js'

// The focused game's box art, blown up and blurred into a full-bleed backdrop.
//
// The single best trick a console dashboard has: the whole screen takes on the colour
// of whatever you're looking at. But the obvious implementation is also the reason
// Big Picture stuttered, and it's worth saying exactly why:
//
//   · it was keyed on the game id, so every focus change UNMOUNTED the old <img> and
//     mounted a new one — a fresh fetch, a fresh decode, and a fresh 600ms animation
//   · it was blurred at full-screen size, and the cost of a blur scales with the area
//     it covers
//
// Hold right on the stick and you were asking the GPU to build twenty full-screen
// blurs a second. Three things fix it:
//
//   1. TWO STABLE LAYERS that cross-fade. Nothing is ever unmounted, so nothing is
//      ever rebuilt from scratch.
//   2. BLUR IT SMALL, THEN SCALE IT UP. The image is rendered at a fraction of the
//      screen and blown up with a transform, so the (expensive) blur runs over a tiny
//      area and the (free) scale does the rest. It looks identical — it's a blur.
//   3. A SHORT DELAY. Scrolling past forty games shouldn't load forty covers; only
//      the one you actually stop on.
const SETTLE_MS = 140

export default function HeroBackdrop({ game }) {
  // Two layers, swapped between. `top` says which one is currently showing.
  const [layers, setLayers] = useState([null, null])
  const [top, setTop] = useState(0)
  const settleRef = useRef(null)

  useEffect(() => {
    clearTimeout(settleRef.current)
    const next = game ? coverUrl(game.id) : null
    if (next === layers[top]) return

    // Wait for the cursor to actually settle. Flying past a rail shouldn't fetch every
    // cover it passes.
    settleRef.current = setTimeout(() => {
      setLayers((cur) => {
        const other = top === 0 ? 1 : 0
        const copy = [...cur]
        copy[other] = next
        return copy
      })
      setTop((t) => (t === 0 ? 1 : 0))
    }, SETTLE_MS)

    return () => clearTimeout(settleRef.current)
  }, [game, layers, top])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-slate-950">
      {layers.map((src, i) => (
        <div
          key={i}
          className="absolute inset-0 transition-opacity duration-500"
          style={{ opacity: i === top && src ? 0.4 : 0, willChange: 'opacity' }}
        >
          {src && (
            <img
              src={src}
              alt=""
              aria-hidden="true"
              // Rendered at a tenth of the screen and scaled back up: the blur runs
              // over 1% of the pixels it appears to cover. Same picture, a hundredth
              // of the work.
              className="h-[10%] w-[10%] origin-top-left object-cover blur-[3px]"
              style={{ transform: 'scale(11)' }}
              onError={(e) => {
                e.currentTarget.style.visibility = 'hidden'
              }}
            />
          )}
        </div>
      ))}

      {/* Darken toward the bottom, where the rails sit, so the art never fights the
          tiles for attention. */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-slate-950/40" />
    </div>
  )
}
