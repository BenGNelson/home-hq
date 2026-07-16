import { useEffect, useState } from 'react'
import Frog, { Reflected } from './Frog.jsx'
import { FROG } from './theme.js'

// The boot.
//
// It exists for a reason, not for a logo: **iOS does not report a connected
// controller until a button is pressed on it.** `gamepadconnected` never fires on
// a sleeping pad. So something has to ask you to press a button before Frog can
// know whether you're holding one — and "PRESS A" on a boot screen is a far nicer
// way to ask than a banner that says "no controller detected".
//
// It's also the moment we learn touch-vs-pad, which decides every layout after it.
//
// Rules it has to obey, or it becomes the thing you resent:
//   - Under ~1.6s to the point where it's waiting on you.
//   - SKIPPABLE BY FAST-FORWARDING, not by cutting: a press during the animation
//     jumps to the end state (which is a press-to-continue) rather than hard-cutting
//     to the shelf, so an early press is never swallowed and never double-fires.
//   - Once per app open. Not once per navigation.
export default function Boot({ onDone }) {
  // 'rising' → the frog is surfacing; 'ready' → it's waiting on you.
  const [phase, setPhase] = useState('rising')

  useEffect(() => {
    const t = setTimeout(() => setPhase('ready'), 1150)
    return () => clearTimeout(t)
  }, [])

  // Any key, any button, any tap advances the boot. One rule holds it together: a
  // single input may EITHER fast-forward the animation OR dismiss — never both.
  //
  // Touch is dismissed by the surface's own `onClick` (below), NOT a window listener,
  // and deliberately on `click` rather than `pointerdown`. `click` is the LAST event
  // of a tap (pointerdown → pointerup → click), so dismissing on it consumes the whole
  // gesture while the boot is still the top element — nothing is left to fall through.
  // Dismissing earlier, on pointerdown, unmounts the boot mid-tap, and iOS then
  // retargets the tap's delayed synthetic `click` to whatever shelf tile is now under
  // the finger — drilling into a random console. (Swallowing that ghost click in the
  // capture phase looked fine in a headless tap but lost the race on real iOS.)
  //
  // Keys and gamepad-as-key stay on window; they have no ghost click to worry about.
  useEffect(() => {
    const onKey = () => (phase === 'rising' ? setPhase('ready') : onDone?.())
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, onDone])

  // rising → fast-forward; ready → dismiss. Same rule as the key handler, for taps.
  const advance = () => (phase === 'rising' ? setPhase('ready') : onDone?.())

  return (
    <div
      data-testid="frog-boot"
      onClick={advance}
      // `cursor-pointer` is not cosmetic here: iOS only fires a `click` for a tap on a
      // non-native element when it looks clickable, and this is the flag that flips it.
      className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center overflow-hidden"
      style={{ background: FROG.ground }}
    >
      {/* The pond: a pool of light under the frog, not behind it. */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2"
        style={{
          background: `radial-gradient(circle, rgba(${FROG.jade}, 0.16), transparent 62%)`,
        }}
      />

      {/* Rings, spreading from where it broke the surface. */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="frog-rings absolute left-1/2 top-1/2 h-[34vmin] w-[34vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border"
            style={{ borderColor: `rgba(${FROG.jade}, 0.35)` }}
          />
        ))}
      </div>

      <div className="frog-surface relative flex flex-col items-center">
        <Reflected scale={0.5}>
          <Frog size={168} />
        </Reflected>

        <h1
          className="mt-24 text-5xl font-semibold tracking-[0.22em]"
          style={{ color: FROG.ink, textShadow: `0 0 34px rgba(${FROG.jade}, 0.5)` }}
        >
          FROG
        </h1>
        <p className="mt-2 text-xs tracking-[0.3em]" style={{ color: FROG.faint }}>
          GAME LIBRARY
        </p>
      </div>

      <div className="absolute bottom-[12vh] h-6">
        {phase === 'ready' && (
          <p
            className="frog-invite text-sm font-medium tracking-[0.28em]"
            style={{ color: `rgb(${FROG.jade})` }}
          >
            PRESS A OR TAP
          </p>
        )}
      </div>
    </div>
  )
}
