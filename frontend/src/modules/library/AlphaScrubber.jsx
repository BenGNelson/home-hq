import { useRef, useState } from 'react'
import { ALPHABET, scrubIndex } from '../../lib/library.js'

// The A→Z scrubber: a thin bar pinned to the right edge (iOS-contacts style).
// Run a thumb down it and it jumps the list to that letter; a floating bubble
// previews the current letter while you drag. Tapping a letter works too (and
// keeps it keyboard-reachable). `letters` is the Set of letters actually present
// in the list — absent ones render dimmed and a drag snaps past them to the
// nearest present letter, so a swipe never dead-ends on a gap. `onPick(letter)`
// scrolls that letter's section into view (the parent owns the scroll target).
export default function AlphaScrubber({ letters, onPick }) {
  const barRef = useRef(null)
  const [active, setActive] = useState(false)
  const [current, setCurrent] = useState(null)

  // The present letter nearest an index (searching outward), so dragging over a
  // missing letter lands on the closest one that exists rather than nothing. On
  // a tie (equal distance either side) prefer the later letter, so a downward
  // drag over a gap never snaps the list backward/upward.
  function nearestPresent(idx) {
    for (let d = 0; d < ALPHABET.length; d++) {
      const hi = ALPHABET[idx + d]
      if (hi && letters.has(hi)) return hi
      const lo = ALPHABET[idx - d]
      if (lo && letters.has(lo)) return lo
    }
    return null
  }

  function pickAt(clientY) {
    if (!barRef.current) return
    const idx = scrubIndex(clientY, barRef.current.getBoundingClientRect(), ALPHABET.length)
    const letter = letters.has(ALPHABET[idx]) ? ALPHABET[idx] : nearestPresent(idx)
    if (letter && letter !== current) {
      setCurrent(letter)
      onPick(letter)
    }
  }

  function onDown(e) {
    setActive(true)
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pickAt(e.clientY)
    e.preventDefault() // don't start a text selection / scroll gesture
  }
  function onMove(e) {
    if (active) pickAt(e.clientY)
  }
  function end() {
    setActive(false)
    setCurrent(null)
  }

  return (
    <>
      {/* The letter bubble preview — large, centered, only while dragging. */}
      {active && current && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed left-1/2 top-1/2 z-30 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-slate-800/90 text-4xl font-semibold text-violet-200 shadow-xl ring-1 ring-violet-400/30 backdrop-blur"
        >
          {current}
        </div>
      )}

      <nav
        ref={barRef}
        aria-label="Jump to letter"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        className="fixed right-0 top-1/2 z-20 flex -translate-y-1/2 select-none flex-col items-center pl-2 pr-1 [touch-action:none] [padding-right:calc(env(safe-area-inset-right)+0.25rem)]"
      >
        {ALPHABET.map((letter) => {
          const present = letters.has(letter)
          // Letters are pointer-events-none so a press/drag always lands on the
          // <nav> (above) — pressing directly on a letter, even an absent
          // disabled one, must not swallow the gesture. The <button> stays for
          // keyboard: Tab to a present letter + Enter jumps (onClick); a tap or
          // drag goes through the nav's pointer handlers instead.
          return (
            <button
              key={letter}
              type="button"
              disabled={!present}
              onClick={() => present && onPick(letter)}
              aria-label={present ? `Jump to ${letter}` : undefined}
              className={`pointer-events-none flex h-[3.4vh] max-h-4 min-h-[11px] w-5 items-center justify-center text-[10px] font-semibold leading-none ${
                present ? 'text-violet-300/80' : 'text-slate-700'
              } ${current === letter ? 'text-violet-200' : ''}`}
            >
              {letter}
            </button>
          )
        })}
      </nav>
    </>
  )
}
