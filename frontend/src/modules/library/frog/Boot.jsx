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

  // Any key, any button, any tap. The handler is deliberately indiscriminate:
  // whatever you reach for first is the thing that should work.
  //
  // The one subtlety is the DISMISS tap. We advance on `pointerdown`, so the instant
  // a finger touches down the boot unmounts — and the SAME tap's trailing `click`
  // then lands on whatever shelf tile is now under the finger, drilling into a random
  // console. (A ghost click, and on a phone the systems grid is right where a thumb
  // taps.) So when the dismiss fires, swallow exactly one following click in the
  // capture phase before it can reach the shelf. A key press dismisses with no click
  // to swallow, so that path stays plain.
  useEffect(() => {
    const onKey = () => (phase === 'rising' ? setPhase('ready') : onDone?.())
    const onPointer = () => {
      if (phase === 'rising') return setPhase('ready')
      // Swallow exactly the ghost click that belongs to THIS dismissing tap, then
      // disarm. Two ways to disarm besides eating the click, so a real follow-up tap
      // is never lost: the next genuine pointerdown (that tap's own click must pass),
      // and a 700ms backstop in case the dismiss gesture produced no click at all
      // (e.g. the browser treated it as a drag).
      const disarm = () => {
        window.removeEventListener('click', eat, true)
        window.removeEventListener('pointerdown', disarm, true)
        clearTimeout(t)
      }
      const eat = (ev) => {
        ev.stopPropagation()
        ev.preventDefault()
        disarm()
      }
      window.addEventListener('click', eat, true)
      window.addEventListener('pointerdown', disarm, true)
      const t = setTimeout(disarm, 700)
      onDone?.()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [phase, onDone])

  return (
    <div
      data-testid="frog-boot"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden"
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
